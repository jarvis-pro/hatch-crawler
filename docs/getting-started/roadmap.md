# 实施路线

> 早期方案曾计划 pnpm workspace + monorepo（`packages/*` + `apps/*`），后期收敛为单仓 Next.js 应用，
> 源码集中在 `src/`。本文记录整个项目的完整交付计划，已完成部分同时充当"现在每块在哪儿"的速查。

## 交付内容

### 爬虫引擎模块 ✅

把早期 CLI 爬虫拆出独立的"引擎库"边界，让上层（CLI / Worker / smoke）都能复用。

```
src/lib/crawler/          core / middleware / parsers / spiders / storage / utils / config
src/lib/shared/           CrawlerEvent 等跨层共享类型
scripts/smoke.ts          内存 Storage 跑一遍示例 Spider，作为引擎自测入口
```

`Storage` 接口 + 内存 / file / SQLite 实现（脱机调试）。早期方案中的 `apps/cli` 已不存在，CLI 形态已被看板取代。

---

### Postgres 持久化 + pg-boss 队列 ✅

数据层立起来，能本地连 Postgres，跑通 schema 迁移；pg-boss 队列就绪。

```
prisma/schema.prisma       Prisma 权威 schema（含 Spider/Run/Event/Item/Visited/Setting）

src/lib/db/
├── client.ts              PrismaClient 单例
├── boss.ts                pg-boss 客户端单例 + queue 名常量
├── migrate.ts             runMigrations(): 内联 SQL 幂等建表 + boss.start() 自建 pgboss schema
├── repositories/          runs / items / events / settings / spiders / visited
└── index.ts               re-export + 业务实体类型（收紧 jsonb 列）

scripts/
├── db-migrate.ts          手动迁移入口（pnpm db:migrate）
└── db-seed.ts             种子数据（pnpm db:seed）
```

新增依赖：`@prisma/client`、`prisma`、`pg-boss`。

---

### 看板 + API + SSE + 内置 Worker ✅

Web UI、API、SSE、内置 pg-boss worker 全部到位，浏览器里完成 `docs/reference/dashboard-spec.md` 中的所有用户旅程。所有 `apps/web/*` 路径已合并到根 `src/*`。

```
src/instrumentation.ts              Next.js 钩子：runMigrations + startWorker

src/app/
├── layout.tsx / providers.tsx / globals.css / page.tsx
├── dashboard/page.tsx
├── spiders/page.tsx + spiders/[name]/page.tsx
├── runs/page.tsx + runs/[id]/page.tsx
├── items/page.tsx + items/[id]/page.tsx
├── settings/page.tsx
├── api/
│   ├── spiders/route.ts、spiders/[name]/route.ts
│   ├── runs/route.ts、runs/[id]/{route,stop,events}/route.ts
│   ├── items/route.ts、items/[id]/route.ts
│   ├── settings/[key]/route.ts
│   └── stats/summary/route.ts
└── sse/runs/[id]/logs/route.ts

src/components/
├── ui/                              shadcn 复制下来的基础组件
├── nav/sidebar.tsx + nav/topbar.tsx
├── runs/{run-status-badge,new-run-dialog,live-log-stream}.tsx
├── items/json-viewer.tsx
└── stats/stats-card.tsx

src/lib/
├── api-client.ts                   前端调 /api/* 封装
├── query-client.ts                 TanStack Query 配置
├── spider-registry.ts              name → Spider 类
├── env.ts                          环境变量校验
├── api/response.ts                 统一响应包装
└── worker/
    ├── index.ts                    startWorker() / 优雅关停 / 单例守卫
    ├── job-handler.ts              单 job 执行：取 Spider、注入 PostgresStorage、串事件流
    ├── postgres-storage.ts         实现 crawler Storage 接口（写 items / visited）
    └── event-bus.ts                进程内 EventBus（SSE 用）
```

stale-run cleanup 与 SSE 订阅的内存通道都在 `src/lib/worker/` 内部完成，未单独拆文件。

新增依赖：`next` 15+, `react` 19+, `tailwindcss`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `zod`, `sonner`（toast），shadcn 的若干组件。

---

### Docker Compose 一键起 ✅

干净机器上 `git clone && docker compose up` 能跑。

```
Dockerfile                  根目录单一 Dockerfile（多阶段：deps → builder → runner）
docker-compose.yml          postgres + web 两个服务
.dockerignore
.env.example                合并后单一样板（本地 dev + docker compose 共用）
docs/deploy/deployment.md
```

`docker-compose.yml` 只有 **2 个服务**：

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-hatch}
      POSTGRES_USER: ${POSTGRES_USER:-hatch}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-hatch}
    volumes:
      - pg_data:/var/lib/postgresql/data
    ports:
      - '127.0.0.1:5432:5432'
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U $${POSTGRES_USER:-hatch} -d $${POSTGRES_DB:-hatch}']

  web:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-hatch}:${POSTGRES_PASSWORD:-hatch}@postgres:5432/${POSTGRES_DB:-hatch}
      NODE_ENV: production
    ports:
      - '127.0.0.1:3000:3000'
    depends_on:
      postgres: { condition: service_healthy }

volumes:
  pg_data:
```

Dockerfile 策略：多阶段构建（`deps` / `builder` / `runner`），`node:22-alpine` 基镜像，`pnpm install --frozen-lockfile` → `pnpm build` → 复制 `.next/standalone`，runner 用非 root `nextjs` 用户启动 `node server.js`。

---

### Kind 化 + 平台标记 ✅

> 完整设计见 [`rfcs/0001-multi-platform.md`](../rfcs/0001-multi-platform.md)（4 层抽象的进一步推进尚在 Draft）

在不改业务行为的前提下，给现有数据加上 `platform` / `kind` / `sourceId` 维度，建立资源类型的 Zod schema 体系。这是凭据管理和媒体下载管道的地基。

```
src/lib/crawler/kinds/
├── index.ts              ResourceItem discriminated union
├── video.ts              Zod schema
├── audio.ts
├── image.ts
├── article.ts            ← 现有 nextjs-blog 的目标 kind
└── post.ts

prisma/schema.prisma
├── Item 加列：platform / kind / sourceId
├── Item 加 (platform, sourceId) 唯一索引、kind 索引
└── Spider 加列：platform / emitsKinds

src/lib/db/migrate.ts
└── BUSINESS_SCHEMA_SQL 加 ALTER TABLE 段（幂等）
   + 一次性 backfill：UPDATE items SET platform='nextjs-blog', kind='article', sourceId=url_hash WHERE platform IS NULL

src/lib/worker/job-handler.ts
└── 在 emit 路径加 Zod 校验（按 kind 路由 schema）
```

API 影响：`GET /api/items` 返回多 3 个字段，列表过滤参数加 `platform=` / `kind=`，看板 `/items` 顶部筛选条增加两栏。

验证：跑一次现有 `nextjs-blog` Run，落库的 item 应该有完整的 platform / kind / sourceId；在看板 `/items?kind=article` 能筛出；旧 API 调用（不带新参数）行为不变。

---

### 第一个真平台 + 凭据管理 ✅

> 实际落地：YouTube + Bilibili + 小红书 + 微博 + 抖音 共 5 个平台，accounts 加密管理就位。

按 Platform/Spider 分层写出第一个真平台，验证四层抽象是否站得住。顺带把 `accounts` 表立起来（cookie / OAuth 总要有）。

**推荐第一选：** YouTube Data API v3（有官方 API、限额清晰、文档全）。**备选：** Bilibili 公开接口（无需登录就能取大量数据，但有 wbi 签名）。

```
src/lib/crawler/platforms/
├── _base.ts                Platform 接口定义
└── <platform>/
    ├── index.ts            Platform 描述对象 + 共享 helper
    ├── auth.ts             cookie / OAuth / 签名注入
    ├── parsers.ts
    └── spiders/
        ├── channel-videos.ts   或 up-space.ts
        └── search.ts

src/lib/crawler/fetcher/
├── http.ts                 现有逻辑挪进来
└── api.ts                  平台 API client wrapper（带 auth + rate limit）

prisma/schema.prisma
└── 新 model：Account（payloadEnc 加密存储）

src/lib/db/repositories/accounts.ts
└── 加密读写、按 platform 取 active account、记录 lastUsedAt / failureCount

src/app/api/accounts/
├── route.ts                CRUD
└── [id]/test/route.ts      测试凭据是否仍然有效

src/app/settings/page.tsx
└── 新增 "Accounts" Tab

src/lib/spider-registry.ts
└── 注册新 spider，并注入对应 Platform
```

关键决策：`accounts.payloadEnc` 用 `node:crypto` AES-256-GCM 加密，master key 从 env 读：`ACCOUNTS_MASTER_KEY`（base64 32 bytes），docker-compose 里给一个默认值，生产请改。第一个平台至少要写 2 个 Spider（典型如 `channel-videos` + `single-video`），才能暴露"共享 Platform helper"的真实需求。本阶段不下载视频文件，emit 的 video item 里 `media[]` 只有 URL，本地播放走外链。

验证：看板 `/spiders` 看到 `<platform>/<spider>` 形式的新 spider；`/settings` Accounts Tab 能添加 cookie，Spider Run 时被正确注入；抓 100 条视频元数据落库，`/items?platform=<platform>&kind=video` 能查到；故意用错误 cookie 跑：account.failureCount 自增、达到阈值后 status='disabled'。

**写第二个平台前的验收 gate：** 写第二个平台的总工作量应该是第一个的一半以下；如果不是，说明抽象设歪了，回去改 `_base.ts` 和 `fetcher/api.ts`。**别忍。**

---

### 媒体下载与转码管道 ✅

> 完整设计见 [`rfcs/0002-media-downloads.md`](../rfcs/0002-media-downloads.md)
>
> **早期设想 vs 实际落地的差异：** 早期方案叫 `Asset` / `AssetStore`，落地时改名 `Attachment` / `FileStorage`，
> 与 `Item` 用关系列直接挂载（`item_id`），不再通过 `media[]` 索引；新增了 RFC 草案没列的"视频→音频转码"
> 子系统（ffmpeg）和 YouTube 适配（yt-dlp），并把"自动派发 vs 手动派发"做成 spider 级开关 `autoDownload`。

```
prisma/schema.prisma
├── 新 enum：AttachmentKind（video/audio/image/archive/document/other）
├── 新 enum：AttachmentStatus（queued/downloading/transcoding/completed/failed）
├── 新 model：Attachment（含 sha256 去重 / parent_id 派生 / status 状态机 / progress_pct）
├── Spider 加列：auto_download
└── Run 加列：attachments_queued / attachments_completed / attachments_failed

src/lib/db/
├── boss.ts                  + QUEUE_DOWNLOAD / QUEUE_TRANSCODE 常量与 Job 类型
├── migrate.ts               + ALTER TABLE 段（幂等）
└── repositories/attachments.ts

src/lib/storage/
└── files.ts                 FileStorage 接口 + LocalFileStorage 实现
                             （路径白名单 + 防逃逸 + sha256 + STORAGE_BACKEND env 预留 S3）

src/lib/downloads/
├── http-fetcher.ts          got stream + downloadProgress + Content-Type 嗅扩展名
├── ytdlp-fetcher.ts         spawn yt-dlp（无 shell）+ 临时目录合并 mp4
├── ffmpeg-runner.ts         spawn ffmpeg + ffprobe 拿时长 + -progress pipe:1 解析
└── system-deps.ts           检测 ffmpeg / yt-dlp 可用性（5 分钟 cache）

src/lib/worker/
├── download-job-handler.ts  按 fetcherKind 路由 http / yt-dlp，进度节流到 DB
├── transcode-job-handler.ts 视频→音频，派生 attachment 链接到源
├── attachment-dispatcher.ts run 完成后扫 payload.media[] + youtube 视频 item，批量派发
├── host-limits.ts           youtube host 进程内串行化（mutex chain）
├── job-handler.ts           + run 完成后按 spider.autoDownload 自动派发
└── event-bus.ts             + AttachmentEvent 通道

src/lib/shared/events.ts     + AttachmentEvent union（queued/started/progress/completed/failed）

src/app/api/
├── items/[id]/attachments/route.ts        GET 列表 + POST 创建并入队
├── attachments/route.ts                   GET 全局列表（过滤 spider/status）
├── attachments/[id]/route.ts              GET 详情 + DELETE
├── attachments/[id]/download/route.ts     stream 文件本体
├── attachments/[id]/retry/route.ts        失败重试（按 parentId 自动选队列）
├── attachments/[id]/transcode/route.ts    派生新 attachment 入 transcode 队列
├── attachments/gc/route.ts                清理 N 天前 failed
├── runs/[id]/download-all/route.ts        一键派发本 run 全部可下载
└── system/health/route.ts                 ffmpeg / yt-dlp 健康度

src/app/sse/attachments/[id]/progress/route.ts   实时进度（含终态保护 + 心跳）

src/app/
├── attachments/page.tsx                   全局总览（chip 过滤 + 重试 + GC）
├── items/[id]/page.tsx                    嵌入 <AttachmentsPanel>
├── runs/[id]/page.tsx                     + 「一键下载附件」按钮
├── spiders/[name]/page.tsx                + 「开启/关闭自动下载」toggle
└── settings/page.tsx                      + 「下载」tab（系统依赖 + YouTube 启用开关 + 法律免责）

src/components/items/attachments-panel.tsx 状态徽章 + 进度条 + SSE 实时 + 转 mp3 + 下载/删除

scripts/smoke-download.ts                  端到端烟雾测试（HTTP API + 队列 + 下载 + GET 文件）
```

配置：`.env` 加 `STORAGE_BACKEND=local`（默认）、`STORAGE_LOCAL_ROOT=./data`（默认）、`STORAGE_MAX_GB=50`（默认；0 不限）。
看板「设置 → 下载」可手动启用 YouTube 下载（默认关，需 yt-dlp 可用）。
Dockerfile 内置 `ffmpeg + yt-dlp`；本地 dev 用 `brew install ffmpeg yt-dlp`。
`docker-compose.yml` 把 `data/` 卷挂出（`VOLUME ["/app/data"]` 已加）。

验证（已通过）：

- `pnpm smoke:download` 走完 API → pg-boss → fetcher → storage → markCompleted → GET stream，文件字节数与 DB 吻合
- 端到端：`payload.media[]` 自动派发 thumbnail 下载 + YouTube `video` item 自动派 yt-dlp，并发被 host-limits 串行化
- 看板 `/attachments` chip 过滤 / 重试 / GC 全部可用
- 失败下载可视：`status=failed` 行高亮 + `errorMessage` + 「重试」按钮

---

## 工作量一览

| 模块                | 实际位置                                              | 工作量                                                                                      | 状态 |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---- |
| 爬虫引擎            | `src/lib/crawler` + `shared`                          | 引擎抽象 + Storage 接口                                                                     | ✅   |
| Postgres + pg-boss  | `src/lib/db` + `scripts/db-*`                         | schema + 内联 SQL 迁移 + repository                                                         | ✅   |
| 看板 + API + Worker | `src/app` + `src/lib/worker`                          | API + 看板 UI + 内置 Worker（占大头）                                                       | ✅   |
| Docker Compose      | 根 `Dockerfile` + compose                             | 配置为主                                                                                    | ✅   |
| Kind 化 + 平台标记  | `src/lib/crawler/kinds` + schema 变更                 | 加列 / Zod schema / 一次性 backfill（~10 个文件）                                           | ✅   |
| 真平台 + 凭据管理   | `src/lib/crawler/platforms` + accounts                | Platform 抽象 + 5 个平台 + accounts 加密 CRUD + 自动 ban                                    | ✅   |
| 媒体下载与转码管道  | `src/lib/downloads` + `src/lib/storage` + attachments | RFC 0002 全套：attachments 表 + http/yt-dlp/ffmpeg + 看板 + autoDownload + GC（~35 个文件） | ✅   |

**顺序约束（已成立）：** Kind 化先于凭据/媒体落地；凭据先于媒体；多平台已横向铺开 5 个。
后续仍开放的事项见末尾「待完成（仍开放）」清单。

## 验收清单

### 已完成

- [x] `docker compose up` 一行起所有服务
- [x] 浏览器打开 `http://localhost:3000` 看到 Dashboard
- [x] 点"新建运行"能选 Spider + 调参 + 启动
- [x] 跳到 Run 详情看实时日志（SSE 推送）
- [x] Run 完成后能在 Items 页查到结果
- [x] 配置代理 → 重新运行 → 日志里看到代理生效
- [x] 设 cron → 每隔时间自动跑（pg-boss schedule）
- [x] 历史 Run 列表分页正常
- [x] Items 全文搜索能命中 title
- [x] 类型检查 + ESLint + Prettier 全过
- [x] Web 重启后，正在跑的 run 被正确标记为 failed（stale-run cleanup）

### 已完成（媒体下载与转码 — RFC 0002）

- [x] `attachments` 表 + spider.auto*download + run.attachments*\* 三处 schema 同步
- [x] http 直链下载（mp4 / mp3 / zip / pdf 等）通过 `download` 队列入库
- [x] 看板 `/items/:id` 附件面板：手动添加 / 进度条 / 下载文件 / 删除
- [x] SSE `/sse/attachments/:id/progress` 实时推进度（含心跳 + 终态保护）
- [x] ffmpeg 视频→mp3 转码（独立 `transcode` 队列），派生 attachment 与源 parent 关系展示
- [x] yt-dlp 适配 YouTube 视频下载（settings 启用开关 + 法律免责文案 + host 串行化）
- [x] spider 级 `autoDownload` 开关，run 完成后自动派发 `payload.media[]` + youtube video item
- [x] run 详情页「一键下载附件」手动批量
- [x] `/attachments` 总览页（chip 状态过滤 + 失败重试 + N 天前 GC）
- [x] STORAGE_MAX_GB 配额检测（超额拒绝入队 + 看板提示）
- [x] Dockerfile 内置 `ffmpeg + yt-dlp`，本地 dev 用 `brew install`
- [x] `pnpm smoke:download` 端到端烟雾测试

### 已完成（多平台扩展）

- [x] `items` 表所有行都有 `platform` / `kind` / `sourceId`，且 `(platform, sourceId)` 唯一（部分唯一索引 `uniq_items_platform_source`）
- [x] 至少支持 1 个真平台 —— 实际已支持 5 个：`youtube` / `bilibili` / `xhs` / `weibo` / `douyin`，看板可创建 Run
- [x] 至少支持 2 种资源 kind —— 实际已支持 5 种：`article` / `video` / `audio` / `image` / `post`，前端按 kind 富展示（`/items/:id`）
- [x] `accounts` 表加密存储凭据（AES-256-GCM，master key 走 `ACCOUNTS_MASTER_KEY` env），Spider Run 时由 job-handler 自动注入
- [x] 失败/被 ban 的 account 自动降级：`failure_count` 累计 ≥ 阈值（默认 5）→ `status='banned'`；看板「设置 → 凭据管理」实时显示
- [x] 视频 Run 完成后，`attachments` 表有对应记录，文件真实落到 `FileStorage`（RFC 0002 落地）
- [x] `download` 队列卡住 / 失败重试不影响 `crawl` 队列（独立 pg-boss 队列 + retry API）
- [x] 加第 N 个平台时，工作量约等于复制 + 改 200 行（5 平台已落地，验收 gate 实质通过）

### 待完成（仍开放）

- [ ] **RFC 0001 4 层抽象**：现状是平台目录已按 `platforms/<name>/` 组织，但还没正式抽出 `Platform` 接口对象（`auth/sign/fetcher` 配置驱动）。状态见 [`rfcs/0001-multi-platform.md`](../rfcs/0001-multi-platform.md)
- [ ] **HLS / DASH 流下载**：当前只支持直链 mp4 + yt-dlp 兜底，原生 HLS 拼包尚未做（RFC 0002 §"非目标"明确交给 yt-dlp）
- [ ] **S3 / MinIO storage backend**：`STORAGE_BACKEND` env 已留位但只实现了 `local`
- [ ] **proxy 池健康度自动剔除**：proxy 失败计数 + 自动暂停同样模式（参考 accounts ban 机制）
