# 架构总览

> hatch-crawler 当前形态："多平台视频/内容元数据爬虫 + 看板 + 进程内 worker"。
> 本文记录 _现在是什么_。重大改动请先在 [`../rfcs/`](../rfcs/) 立项。

## 一句话定位

单仓 Next.js 15 应用，浏览器看板 + REST API + SSE 实时日志 + 同进程 pg-boss worker，
共享一个 Postgres，`docker compose up` 一键拉起。引擎专注从 5 大内容平台
（YouTube / Bilibili / 小红书 / 微博 / 抖音）抽取视频/帖子元数据，并支持按用户粘贴的 URL 列表逐条提取。

## 关键决策：合并部署

Web/API 与 pg-boss worker 跑在同一个 Next.js 进程。`src/instrumentation.ts` 启动时：

1. `runMigrations(DATABASE_URL)` 跑业务表幂等 DDL
2. `ensureBuiltinSpiders()` 写入内置 `url-extractor` 行（已存在则跳过）
3. `startWorker()` 拉起 pg-boss worker，订阅 `crawl` 队列 + 注册所有启用 Spider 的 cron 调度

不引 Redis（pg-boss 用 Postgres 做队列 + cron 调度）；不分 web/worker 进程（学习/单用户场景下分进程的代价大于收益）。要拆请先在 `docs/rfcs/` 立项。

## 服务拓扑

```
                ┌──────────────┐
                │   Browser    │
                └──────┬───────┘
                       │ HTTP / SSE
                       ▼
                ┌──────────────────────────────┐
                │  Next.js 15 单进程            │
                │                              │
                │  /dashboard /spiders /runs.. │
                │  /api/*                      │
                │  /sse/runs/:id/logs          │
                │                              │
                │  pg-boss worker（同进程）     │
                │  EventBus      （同进程）     │
                │  src/lib/crawler 引擎         │
                └──────────────┬───────────────┘
                               │ SQL
                               ▼
                       ┌──────────────┐
                       │   Postgres   │
                       │              │
                       │  spiders     │  业务表
                       │  runs        │
                       │  events      │
                       │  items       │
                       │  accounts    │
                       │  settings    │
                       │              │
                       │  pgboss.*    │  pg-boss 自管表（队列 + cron）
                       └──────────────┘
```

容器只有两个：`postgres` + `web`（含 worker、ffmpeg、yt-dlp）。

## 模块职责

整个项目是一个 Next.js 应用，源码在 `src/`。下面按目录拆分职责。

### `src/lib/crawler` — 爬虫核心引擎

```
src/lib/crawler/
├── core/              Fetcher / UrlQueue / Scheduler / BaseSpider + runSpider
├── middleware/        proxy-pool / ua-pool / host rate-limiter
├── parsers/           next-data-parser / html-parser
├── kinds/             资源类型 Zod schema：article / video / audio / image / post
├── platforms/         平台目录（每平台一份 helpers + parsers + spiders/）
│   ├── youtube/       channel-videos / search
│   ├── bilibili/      user-videos / search / video-detail
│   ├── xhs/           search / user-notes / note-detail / note-comments
│   ├── weibo/         search / user-posts
│   └── douyin/        search / user-videos
├── extractors/        URL 驱动的单页提取器（types / registry / youtube/）
├── spiders/           跨平台 spider：url-extractor（按 URL 列表逐条提取）
├── fetcher/           api.ts —— 平台 API 客户端封装
├── storage/           Storage 接口 + 内存 / file / SQLite 实现（脱机调试）
├── utils/             logger / url / yt-dlp-formats
├── config/            运行时配置组装
└── index.ts           对外公共导出
```

引擎层与 _存储 / 队列_ 解耦：worker 在 `src/lib/worker/` 注入 `PostgresStorage`，`scripts/smoke.ts` 注入内存 Storage。

#### 三种 Spider 形态

1. **平台 Spider**（`platforms/<p>/spiders/*`）：基于平台 API 或 HTML，按入口策略遍历。例 `youtube-channel-videos`、`bilibili-search`。
2. **URL Extractor**（`spiders/url-extractor`）：用户粘贴一批 URL，spider 拿到后逐条调用 `extractors/registry` 路由到对应 extractor，emit 单条 video item。专为 `/api/extract` 设计。
3. **新平台扩展点**：写一个 Extractor 比写一个 Spider 更轻——只要在 `extractors/<platform>/` 加一个实现 `Extractor` 接口的对象，并在 `extractors/registry.ts` 里 push 一行即可，url-extractor 自动认得。

### `src/lib/db` — 数据访问层

```
src/lib/db/
├── client.ts                 PrismaClient 单例（dev HMR 守卫）
├── boss.ts                   pg-boss 客户端单例 + QUEUE_CRAWL 常量 + CrawlJobData
├── migrate.ts                runMigrations()：内联幂等 SQL
├── ensure-builtin-spiders.ts 启动期 seed url-extractor 行
├── repositories/             runs / items / events / settings / spiders / accounts
└── index.ts                  re-export + 业务实体类型（收紧 jsonb）
```

`prisma/schema.prisma` 是权威 schema；`migrate.ts` 是与 schema 手工同步的幂等 DDL（含历史 ALTER 段，保证从旧库无缝升级）。详见 [`../reference/data-model.md`](../reference/data-model.md)。

### `src/lib/worker` — 进程内 pg-boss worker

```
src/lib/worker/
├── index.ts            startWorker / abortRun / syncSpiderSchedule / 单例守卫
├── job-handler.ts      单个 crawl job：取 spider、注入凭据、串事件流、自动停用、Webhook
├── postgres-storage.ts Storage 接口的 PG 实现（含 kind schema 软校验）
└── event-bus.ts        进程内 EventBus（runId → channel）
```

#### `job-handler` 在每个 job 里做的事

1. 用 `spider.type` 反查 `SPIDER_REGISTRY`（找不到 → 标 failed 立即抛）
2. 应用 `overrides` 到全局 crawler config
3. 组装 spider 构造参数：`defaultParams` 打底，`overrides` 覆盖
4. 自动注入凭据：从 `accounts` 表按 `entry.platform` 取 active `apikey` / `cookie`，挂到 params
5. 注入代理：从 `settings.proxy_pool` 读取
6. 桥接事件：CrawlerEvent → `events` 表（debug 不入库）+ EventBus 推 SSE + 增量更新 `runs.fetched/emitted/newItems/errors`
7. 完成后：成功重置 `consecutive_failures`，失败递增——超阈值（默认 3）自动停用 spider 并发 Webhook
8. `excludeFromAutoDisable` 标记的 spider（如 url-extractor）跳过 4) 之外的失败计数，避免用户粘失效链接把功能关掉

### `src/lib/downloads` — 媒体下载工具（按需使用）

```
src/lib/downloads/
├── http-fetcher.ts    got stream（仅留 lib，已不再走队列）
├── ytdlp-fetcher.ts   spawn yt-dlp（仅留 lib）
└── system-deps.ts     检测 ffmpeg / yt-dlp 可用性（5 分钟 cache，看板顶部 banner 用）
```

> 历史包袱说明：早期有完整的 attachments 队列与离线下载，目前已下线，`download` / `transcode` 队列与 `attachments` 表都已移除。当前下载形态是
> "用户在 item 详情页点击 → 后端按需 spawn → 流式回浏览器"（见 `/api/items/:id/download` 与 `/api/items/:id/formats`）。
> `src/lib/downloads/*` 保留为调用 yt-dlp/http 的工具实现。

### `src/lib/shared` / `src/lib/api` / 其他

- `shared/events.ts` — `CrawlerEvent` 联合类型（fetched / queued / skipped / emitted / fetch_failed / error / done）
- `api/response.ts` — 所有 `app/api/**/route.ts` 必须经它包装：`ok()` / `fail()` / `failValidation()` / `failInternal()`
- `api-client.ts` — 浏览器调 API 的封装
- `query-client.ts` — TanStack Query 配置
- `spider-registry.ts` — 注册表：`name → { factory, platform?, excludeFromAutoDisable? }`，新增平台 spider 必须在这里登记
- `env.ts` — 环境变量懒校验，`accountsMasterKey` / `databaseUrl` / `logLevel` 等都从这里取
- `storage/files.ts` — 本地文件存储抽象（保留接口，目前未被业务路径调用）

### `src/app` — Next.js App Router

```
src/app/
├── layout.tsx / providers.tsx / globals.css / page.tsx (→ /dashboard)
├── dashboard/page.tsx              统计卡片 + 趋势图 + 平台/类型 breakdown + 最近 Run
├── spiders/page.tsx + [name]/      Spider 列表 + 详情（[name] 实际承载 spiders.id UUID）
├── runs/page.tsx + [id]/page.tsx   Run 列表 + 详情（含 LiveLogStream）
├── items/page.tsx + [id]/page.tsx  Items 列表 + 详情（视频下载菜单 / 获取格式）
├── settings/page.tsx               全局参数 / 凭据 (accounts) / 系统依赖 / Webhook
├── api/
│   ├── spiders/route.ts、[name]/route.ts、registry/route.ts
│   ├── runs/route.ts、[id]/{route,stop,events}/route.ts
│   ├── items/route.ts、[id]/{route,download,formats}/route.ts
│   ├── extract/route.ts                       按 URL 列表创建 run
│   ├── accounts/route.ts、[id]/{route,test}/route.ts
│   ├── settings/[key]/route.ts、settings/webhook_test/route.ts
│   ├── stats/{summary,trend,breakdown}/route.ts
│   └── system/health/route.ts                 ffmpeg / yt-dlp 检测
└── sse/runs/[id]/logs/route.ts                实时日志 + 历史事件回放
```

### `src/components`

```
src/components/
├── ui/      shadcn 基础组件（已复制进仓库，直接编辑）
├── nav/     sidebar / topbar / theme-toggle
├── runs/    run-status-badge / new-run-dialog / live-log-stream
├── items/   json-viewer
└── stats/   stats-card
```

### `src/instrumentation.ts`

Next.js 进程启动钩子，仅在 `nodejs` runtime 跑：

1. `runMigrations(DATABASE_URL)`
2. `ensureBuiltinSpiders(db)` — 把内置 spider（目前只有 `url-extractor`）幂等写入 `spiders` 表
3. `startWorker()` — 启动 pg-boss worker

## 数据流

### 启动一次抓取

```
浏览器 POST /api/runs { spiderId, overrides? }
  → 校验 spider 存在且 enabled
  → INSERT runs (status='queued')
  → pgboss.send('crawl', { runId, spiderId, overrides })
  → 200 { id }
浏览器 GET /sse/runs/:id/logs
  ↑                   ↓ 同进程 EventBus + 历史事件回放（首连补帧）
worker 拉到 job
  → markStarted
  → 取 spider、注入凭据/代理、构造 Spider 实例
  → runSpider(spider, { storage, onEvent, signal })
  → 每个 CrawlerEvent：events 表 + EventBus + runs 增量统计
  → markFinished('completed' | 'failed' | 'stopped')
  → 成功：resetFailures；失败：recordFailure（超阈值自动 disable）
  → 触发 Webhook（settings.webhook_url 配置时）
```

### URL 列表抽取（`/api/extract`）

```
浏览器 POST /api/extract { urls: string[] (1..50) }
  → trim + 去重 + URL 格式校验，分 accepted / rejected
  → 取内置 url-extractor spider
  → INSERT runs (overrides: { urls: accepted })
  → pgboss.send('crawl', ...)
  → 200 { runId, accepted, rejected }
worker 走和上面相同的链路；UrlExtractorSpider 内部按 URL 调 extractor 注册表，不识别的 URL 仅 ctx.log error，不让 run 失败。
```

### 停止运行

```
浏览器 POST /api/runs/:id/stop
  → 校验 status === 'running'
  → abortRun(id)：触发当前 job 的 AbortSignal（worker 进程内 Map）
  → markFinished('stopped')，前端立即看到状态
  → worker 收到 signal 后会自行清理资源
```

> 这套机制不经过 EventBus、不经过 pg-boss，单纯靠进程内 `globalThis` 上的 abort 表。将来拆 worker 时这块要换成 pg-boss `cancel` 或 Redis pub/sub。

### 浏览历史结果

`GET /api/items?platform=&kind=&spider=&runId=&q=&page=&pageSize=` 直接查 Postgres；前端 TanStack Query 轮询。

### Cron 调度

Spider 的 `cron_schedule` 字段非空时，`syncSpiderSchedule(spiderId, cronExpression)` 会在 pg-boss 上注册一条 `crawl-cron:<spiderId>` 队列，到点产出 `triggerType='cron'` 的 run。`spiders` 增删改时会自动同步到 pg-boss schedule。

## 实时性策略

| 场景            | 方案                     | 备注                         |
| --------------- | ------------------------ | ---------------------------- |
| 单 Run 实时日志 | SSE + 内存 EventBus      | 首连时从 `events` 表补帧去重 |
| Run 列表/详情   | TanStack Query 2-5s 轮询 | 终态停止轮询                 |
| Items 列表      | 10s 轮询                 | 用户主动浏览                 |
| Settings 变更   | 表单 submit invalidate   | 不需要实时                   |
| 系统依赖检测    | 5 分钟进程内 cache       | 看板顶部 banner              |

## 单进程的几个边界

- **冷启动 stale-run 清理**：`startWorker()` 把超过 30 分钟未更新的 `running` run 标 failed
- **Next.js dev 热重载**：`PrismaClient` / `PgBoss` / worker state / abortControllers 都用 `globalThis` 守卫
- **`server-only` 边界**：`env.ts`、`worker/*`、所有 `route.ts` 顶部 `import 'server-only'`，禁止被前端 bundle 拉入
- **`force-dynamic`**：SSE 路由设 `export const dynamic = 'force-dynamic'` + `runtime = 'nodejs'`，避免被静态化

## 凭据管理（accounts）

- AES-256-GCM 加密 payload，主密钥从 `ACCOUNTS_MASTER_KEY` 读取（hex 64 字符 = 32 字节）
- 本地不设主密钥时 fallback 全零密钥（仅 dev 用）
- worker 取 active 凭据时按 `(platform, kind)` 查询，按 `failure_count` 升序
- 每次 run 结束：成功不变、失败累加；超阈值（默认 5）自动转 `banned`
- 看板可手动 unban（`PATCH /api/accounts/:id` `{action:'unban'}`），可触发远程验证（`POST /api/accounts/:id/test`）
- YouTube apikey 验证消耗 1 配额单位（videos.list），写入 `last_tested_at` / `last_test_ok` / `quota_used_today`

## 安全与认证

当前不做认证。`docker-compose.yml` 默认绑 `127.0.0.1`，假设单用户本地。要加 auth 推荐 NextAuth + Postgres adapter，并在 `src/middleware.ts` 校验 session。

## 关键设计权衡

| 问题      | 选择                           | 替代方案              | 理由                                                  |
| --------- | ------------------------------ | --------------------- | ----------------------------------------------------- |
| 数据库    | Postgres                       | SQLite / MongoDB      | 单写多读够用，jsonb 友好，pg-boss 共库                |
| 队列+调度 | pg-boss                        | BullMQ + Redis        | 不引 Redis；cron / retry / 并发都自带                 |
| ORM       | Prisma 5                       | Drizzle / TypeORM     | 工具链成熟（generate / studio）；jsonb 收紧靠手写类型 |
| UI        | shadcn/ui + Tailwind           | MUI / Antd            | 复制式，可直接编辑                                    |
| 实时      | SSE                            | WebSocket             | 单向就够；首连补帧靠读 events 表                      |
| 进程拓扑  | 单进程                         | 拆 web + worker       | 学习/单用户场景下分进程的代价大于收益                 |
| 仓库布局  | 单 package                     | pnpm workspace        | 没有跨包复用需求                                      |
| 资源建模  | items + platform/kind/sourceId | 每平台/每 kind 一张表 | 加新平台/新 kind 不动 schema                          |
| 凭据存储  | accounts 加密 payload          | env / 硬编码          | 多账号轮换、ban 检测、看板可视化                      |
| 视频下载  | 按需流式（HTTP / yt-dlp）      | 离线队列 + 落盘       | 单用户场景下"点了再下"足够；下线了 attachments 子系统 |

## 不做清单

- 不做认证 / 多用户隔离（单用户本地）
- 不做独立 worker 进程
- 不做 Redis
- 不做 K8s
- 不做 Playwright 浏览器渲染（HTTP + `__NEXT_DATA__` + 平台 API 已覆盖）
- 不做插件式 Spider 加载（仍是 TS 代码，重启 web 才生效）
- 不做 CLI（一切走看板；引擎自测用 `pnpm smoke`）
- 不做 monorepo
- 不做离线视频/媒体仓库（已下线 attachments；如需恢复请走 RFC）
- 不做视频转码 / OCR / ASR
- 不做付费墙绕过

## 进一步阅读

- 数据模型：[`../reference/data-model.md`](../reference/data-model.md)
- API 契约：[`../reference/api-spec.md`](../reference/api-spec.md)
- 看板线框：[`../reference/dashboard-spec.md`](../reference/dashboard-spec.md)
- 部署：[`../deploy/deployment.md`](../deploy/deployment.md)
- 重大变更：[`../rfcs/`](../rfcs/)
