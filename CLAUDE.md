# CLAUDE.md

> 给 Claude / AI 编码代理读的项目说明书。改代码前先扫一遍这份文件，能省下大量翻仓的时间。
> 人类读者请先看 `README.md` 和 `docs/getting-started/architecture.md`。

## 项目一句话

`hatch-crawler` 是一个多平台内容爬虫的全栈应用：
**单仓 Next.js 15** = 浏览器看板 + REST API + SSE 实时日志 + 进程内 pg-boss worker，
共享同一个 Postgres，`docker compose up` 一键起。
覆盖 5 平台（YouTube / Bilibili / 小红书 / 微博 / 抖音）+ 跨平台 url-extractor。

## 技术栈速查

| 维度     | 选型                                                           |
| -------- | -------------------------------------------------------------- |
| 运行时   | Node.js 22+（`.nvmrc` 锁定）                                   |
| 包管理   | pnpm 10（`packageManager` 锁定，禁止 npm/yarn）                |
| 框架     | Next.js 15 App Router + React 19 + Turbopack（dev）            |
| 类型     | TypeScript 5 strict + `noUncheckedIndexedAccess`               |
| 数据库   | PostgreSQL 16（业务表 + `pgboss` schema 共库）                 |
| ORM      | Prisma 5（`prisma/schema.prisma` 是权威，`migrate.ts` 同步）   |
| 任务队列 | pg-boss 10（用 Postgres 做队列 + cron，不引 Redis）            |
| 调度     | pg-boss schedule（cron 表达式存 `spiders.cron_schedule`）      |
| UI       | Tailwind 3 + shadcn/ui（已复制到 `src/components/ui/`）+ Radix |
| 状态     | TanStack Query 5                                               |
| 校验     | Zod 3                                                          |
| 日志     | Pino + pino-pretty                                             |
| 路径别名 | `@/*` → `./src/*`                                              |

## 常用命令（务必用 pnpm）

```bash
pnpm dev               # Next.js dev（含 worker、自动迁移、HMR）
pnpm build             # 生产构建
pnpm start             # 生产启动（先 build）
pnpm check             # typecheck + lint + format:check（提交前一定跑这个）
pnpm typecheck
pnpm lint / lint:fix
pnpm format / format:check

pnpm db:generate       # prisma generate（改完 schema.prisma 必跑）
pnpm db:migrate        # 跑 src/lib/db/migrate.ts（开发期手动；生产由 instrumentation 自动）
pnpm db:seed           # 灌默认 settings
pnpm db:studio         # prisma studio

pnpm smoke             # 引擎烟雾测试（内存 Storage，不依赖 DB）
pnpm smoke:download    # 下载链路烟雾测试
```

起本地环境：

```bash
docker compose up postgres -d
DATABASE_URL=postgres://hatch:hatch@localhost:5432/hatch pnpm dev
```

> 视频按需下载需要本机 `ffmpeg` + `yt-dlp`（macOS：`brew install ffmpeg yt-dlp`）。
> Docker 镜像已内置。看板顶部 banner 会按 `/api/system/health` 提示缺失。

## 架构必须知道的几件事

### 1. 单进程合并部署

Web/API 与 pg-boss worker 跑在**同一个 Next.js 进程**。`src/instrumentation.ts` 启动时：

1. `runMigrations(DATABASE_URL)` —— 业务表幂等 DDL
2. `ensureBuiltinSpiders(db)` —— 把 `url-extractor` 内置 spider 写入 `spiders` 表（已存在则跳过）
3. `startWorker()` —— 拉起 pg-boss worker，订阅 `crawl` 队列 + 注册启用 spider 的 cron schedule + 清理 stale runs

不要为了"扩展性"擅自把 worker 拆出去。要拆请先在 `docs/rfcs/` 立项。

### 2. Prisma 和 pg-boss 互补

| 工具        | 管什么                                                              | 表在哪                      |
| ----------- | ------------------------------------------------------------------- | --------------------------- |
| **Prisma**  | 业务实体读写：spiders / runs / events / items / accounts / settings | public schema               |
| **pg-boss** | 任务派发、重试、cron、并发控制                                      | `pgboss` schema，**自管表** |

- 业务表的 schema 在 `prisma/schema.prisma`，**但 DDL 写在 `src/lib/db/migrate.ts` 里手工 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... IF NOT EXISTS`**（保持与 schema.prisma 手动同步）。改字段两边都要改。
- pg-boss 的表由 `boss.start()` 自动建在 `pgboss` schema，**不要手工去碰**。
- 严格演进（多人/生产）时再切到 `prisma migrate dev/deploy`，目前还没切。

### 3. Spider 主键是 UUID，name 是用户标签

- `spiders.id` UUID 是 PK；`type` 是注册表键（如 `youtube-search`）；`name` 是用户自定义中文别名（可重复）。
- `runs.spider_id` UUID FK；同时冗余 `spider_name` 作展示。
- 历史遗留列 `display_name` / `spider_type` 都设了 DEFAULT `''`，新代码不读。

### 4. 数据流（启动一次抓取）

```
浏览器 POST /api/runs { spiderId, overrides? }
  → INSERT runs (status=queued)
  → pgboss.send('crawl', { runId, spiderId, overrides })
  → 200 { id }
浏览器 GET /sse/runs/:id/logs
  ↑                       ↓ 同进程 EventBus + 历史回放（首连补帧 + at 时间戳去重）
worker 拉到 job
  → markStarted
  → 从 spiders 取 spider，用 spider.type 反查 SPIDER_REGISTRY
  → 自动注入 accounts 表中对应 platform 的 active apikey/cookie
  → 注入 settings.proxy_pool 代理列表
  → 注入 PostgresStorage（写 items；含 kind schema 软校验）
  → 每个 CrawlerEvent：events 表 + EventBus + runs 增量统计
  → markFinished('completed' | 'failed' | 'stopped')
  → 成功重置 spider.consecutive_failures；失败 +1，超阈值自动 disable + Webhook
  → settings.webhook_url 配置时 POST 通知
```

### 5. URL 提取走内置 spider

`POST /api/extract { urls }` → 拿内置 `url-extractor` spider（`ensureBuiltinSpiders` 写的行）→ 把 urls 塞到 overrides → 走和上面一样的链路。
`url-extractor` 在 SPIDER_REGISTRY 里标了 `excludeFromAutoDisable: true`：失败不计入 `consecutive_failures`、不连带 ban 账号——因为失败多源于用户粘贴失效链接，不应让整个功能被关闭。

### 6. 停止运行靠内存 AbortController

`abortRun(runId)` 走 `globalThis` 上的 abort 表，**不经过 EventBus、不经过 pg-boss**。
（POST `/api/runs/:id/stop` → `abortRun(runId)` → 当前 job 收到 AbortSignal 自行清理。）
单进程下这样最简单；将来拆 worker 时这块要换实现。

### 7. globalThis 单例守卫

Next.js dev 模式 HMR 会反复 import 模块。所有"全局只能有一个"的对象都用 `globalThis` 守卫，
不要破坏这个模式：

- `src/lib/db/client.ts` — PrismaClient
- `src/lib/db/boss.ts` — pg-boss 实例
- `src/lib/worker/index.ts` — worker 启动状态 + abortControllers Map
- `src/lib/downloads/system-deps.ts` — health check cache

### 8. server-only 边界

只能在 server 跑的模块顶部都写 `import 'server-only'`：`env.ts`、`worker/*`、所有 `route.ts`。
新加 server-only 工具时也加上，避免被前端 bundle 误引用。

## 模块地图（src/）

```
src/
├── app/                              Next.js App Router
│   ├── (页面) dashboard / spiders / runs / items / settings / page.tsx (→/dashboard)
│   ├── api/
│   │   ├── spiders/{route,[name],registry}                Spider CRUD + 注册表枚举
│   │   ├── runs/{route,[id],[id]/{stop,events}}           Run CRUD + 停止 + 事件流
│   │   ├── items/{route,[id],[id]/{download,formats}}     Items + yt-dlp 流式下载 + 格式探测
│   │   ├── extract/route                                  POST URL 列表创建 run
│   │   ├── accounts/{route,[id],[id]/test}                凭据 CRUD + unban + 远程验证
│   │   ├── settings/{[key],webhook_test}                  KV + Webhook 测试
│   │   ├── stats/{summary,trend,breakdown}                仪表盘聚合
│   │   └── system/health                                  ffmpeg / yt-dlp 健康度
│   └── sse/runs/[id]/logs/route                           SSE 实时日志 + 历史回放
├── components/
│   ├── ui/                            shadcn/ui（直接编辑）
│   ├── nav/ runs/ items/ stats/       业务组件
├── lib/
│   ├── crawler/                       爬虫引擎（与存储/队列解耦）
│   │   ├── core/                      Fetcher / UrlQueue / Scheduler / BaseSpider + runSpider
│   │   ├── middleware/                proxy-pool / ua-pool / rate-limiter
│   │   ├── parsers/                   next-data-parser / html-parser
│   │   ├── kinds/                     资源类型 Zod schema：article/video/audio/image/post
│   │   ├── platforms/                 youtube/bilibili/xhs/weibo/douyin（每个含 helpers + parsers + spiders/）
│   │   ├── extractors/                URL 驱动的 extractor（types/registry/youtube）
│   │   ├── spiders/                   跨平台 spider：url-extractor
│   │   ├── fetcher/api.ts             平台 API 客户端封装
│   │   ├── storage/                   Storage 接口 + 内存/file/SQLite（脱机调试）
│   │   ├── utils/                     logger / url / yt-dlp-formats
│   │   └── config/                    运行时配置组装
│   ├── db/
│   │   ├── client.ts                  PrismaClient 单例
│   │   ├── boss.ts                    pg-boss 单例 + QUEUE_CRAWL + CrawlJobData
│   │   ├── migrate.ts                 业务表 DDL（手写，幂等，含历史 ALTER 段）
│   │   ├── ensure-builtin-spiders.ts  启动期 seed url-extractor 行
│   │   ├── repositories/              runs / items / events / settings / spiders / accounts
│   │   └── index.ts                   公开 API + 业务实体类型（收紧 jsonb）
│   ├── worker/
│   │   ├── index.ts                   startWorker / abortRun / syncSpiderSchedule
│   │   ├── job-handler.ts             单个 crawl job 的执行（注入凭据/代理 + 桥事件 + 自动停用 + Webhook）
│   │   ├── postgres-storage.ts        crawler Storage 接口的 PG 实现 + kind schema 软校验
│   │   └── event-bus.ts               runId → channel 的内存 EventBus
│   ├── downloads/                     yt-dlp / http / system-deps（按需流式下载工具）
│   ├── shared/                        跨模块类型（CrawlerEvent 等）
│   ├── storage/files.ts               本地文件存储（保留接口，目前未被业务路径调用）
│   ├── api/response.ts                统一响应包装：ok() / fail() / failValidation() / failInternal()
│   ├── api-client.ts                  前端调 API 封装
│   ├── query-client.ts                TanStack Query 配置
│   ├── spider-registry.ts             注册表：name → { factory, platform?, excludeFromAutoDisable? }
│   ├── env.ts                         环境变量懒校验（databaseUrl / accountsMasterKey / ...）
│   └── utils.ts                       cn() 等
└── instrumentation.ts                 Next.js 启动钩子：迁移 + 内置 spider seed + 启动 worker
```

## 项目惯例

- **注释和文档主要用中文**（README、docs/、代码注释都是中文），保持一致
- **路径别名只用 `@/`**，不要写 `../../../`
- **数据库命名**：表名/列名 snake*case（用 Prisma `@map` / `@@map`），索引 `idx*<table>_<cols>`，唯一 `uniq_<...>`
- **jsonb 列**：在 `src/lib/db/index.ts` 把 Prisma 的 `JsonValue` 收紧成业务类型（如 `Spider.startUrls: string[]`）。新增 jsonb 字段记得跟着加
- **API 响应**：所有 `app/api/**/route.ts` 用 `src/lib/api/response.ts` 的 `ok()` / `fail()` 包装，不要直接 `NextResponse.json`
- **Zod 校验请求体**：route handler 内用 `safeParse`，失败走 `failValidation()`
- **不直接读 `process.env`**：通过 `src/lib/env.ts` 的 `env` 取值（懒校验，缺值才抛）
- **凭据加密主密钥**：`ACCOUNTS_MASTER_KEY` 必须 hex 64 字符，缺则 fallback 全零（仅 dev）
- **better-sqlite3 是 onlyBuiltDependencies 白名单**（pnpm 10 默认不跑 native postinstall）。生产路径走 Postgres，SQLite 只是 storage 模块的脱机调试备胎
- **提交规范**：Conventional Commits（commitlint 中文 subject 已开），`pre-commit` 对暂存文件跑 prettier，`commit-msg` 校验格式

## 写一个新 Spider

### 平台 Spider

1. 新建 `src/lib/crawler/platforms/<p>/spiders/<name>.ts`，继承 `BaseSpider`，实现 `parse(ctx)`
2. 在 `src/lib/spider-registry.ts` 把类映射到注册表键 + 标 `platform` —— **worker 靠这个反查类**
3. 起服务后在看板 `/spiders` 手工创建一行（type 选刚加的注册键）
4. 验证：`pnpm smoke`（纯引擎，可在 `scripts/smoke.ts` 临时改用新 spider）→ 看板"立即运行"（完整链路）

### URL 驱动的 Extractor（推荐用于"按链接抓单页"）

1. 在 `src/lib/crawler/extractors/<platform>/index.ts` 实现 `Extractor` 接口（urlPatterns / match / canonicalize / extractId / extract）
2. 在 `src/lib/crawler/extractors/registry.ts` 的 `extractorRegistry` push 一行（generic 兜底必须最后）
3. 立即可用：`POST /api/extract { urls: [...] }` 自动按 host 路由

### `parse` 里能用的

- `ctx.response.body` —— HTML
- `extractNextData(body)` —— 提取 `__NEXT_DATA__`
- `ctx.emit({ url, type, platform?, kind?, sourceId?, payload })` —— 出 item
- `ctx.enqueue({ url, type })` —— 加新 URL 入队
- `ctx.log('info'|'warn'|'error', message, payload?)` —— 写 events 表 + 推 SSE

## 改 schema 的标准动作

1. 改 `prisma/schema.prisma`
2. **同步**改 `src/lib/db/migrate.ts` 的 DDL（用 `IF NOT EXISTS` / `IF EXISTS` 保持幂等）
3. 如有 jsonb 字段形状变化，同步改 `src/lib/db/index.ts` 的业务类型
4. `pnpm db:generate` 刷 client
5. 改对应 repository
6. `pnpm check` 全绿

## 改完代码必跑

```bash
pnpm check    # typecheck + lint + format:check
```

涉及 schema：再跑 `pnpm db:generate`。
涉及引擎核心：再跑 `pnpm smoke` 验证引擎仍能跑通。

## 不要做的事

- 不要把 worker 拆到独立进程（除非先在 `docs/rfcs/` 立 RFC）
- 不要引 Redis —— pg-boss 的全部价值就是不要 Redis
- 不要直接 `new PrismaClient()` / `new PgBoss()` —— 一律走 `getDb()` / `getBoss()` 单例
- 不要在 client 组件里 import `src/lib/worker/*`、`src/lib/db/*`、`src/lib/env.ts`（server-only）
- 不要绕过 `src/lib/api/response.ts` 自己拼 API JSON
- 不要手动 `INSERT INTO pgboss.*` —— 那是 pg-boss 自管的
- 不要把 `prisma/schema.prisma` 当唯一 schema 来源 —— `migrate.ts` 也必须同步改
- 不要恢复 attachments 子系统（早期落地后已下线，详见 `docs/rfcs/0002-media-downloads.md` 顶部状态）；如确有离线媒体仓库需求请走 RFC
- 不要往 worker 里加直接 `console.log` 大量数据 —— 走 logger / ctx.log，按 level 入 events 表

## 想深入？读这些

- 架构与决策：`docs/getting-started/architecture.md`
- 实施进度 / 待办：`docs/getting-started/roadmap.md`
- 数据模型：`docs/reference/data-model.md`
- API 契约：`docs/reference/api-spec.md`
- 看板规格：`docs/reference/dashboard-spec.md`
- 部署：`docs/deploy/deployment.md`
- 重大变更：`docs/rfcs/`（先开 RFC 再动）
