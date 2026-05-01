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

### Kind 化 + 平台标记 ⏳

> 完整设计见 [`rfcs/0001-multi-platform.md`](../rfcs/0001-multi-platform.md)

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

### 第一个真平台 + 凭据管理 ⏳

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

### 媒体下载管道 ⏳

把媒体文件下载从 Spider 流程里彻底拆出去，单独走 `download` 队列 + `AssetStore` 抽象。

```
prisma/schema.prisma
└── 新 model：Asset（含 status / storagePath / checksum）

src/lib/db/boss.ts
└── 加 QUEUE_DOWNLOAD = "download"

src/lib/db/repositories/assets.ts

src/lib/crawler/downloader/
├── index.ts                Downloader 接口
├── http-stream.ts          直链下载（Range / 断点续传）
├── hls.ts                  m3u8 分片合并
└── ytdlp.ts                yt-dlp 子进程兜底（最广覆盖，最重）

src/lib/worker/
├── download-handler.ts     消费 download 队列
└── asset-store.ts          AssetStore 接口
   ├── local-fs-store.ts    data/assets/<platform>/<yyyymm>/<sha256>.<ext>
   └── s3-store.ts          可选；通过 env 切换

src/lib/worker/crawl-handler.ts
└── emit item 后，按 item.media[] 推 download job

src/app/api/assets/
├── route.ts                列表 / 过滤
├── [id]/route.ts           元数据
└── [id]/raw/route.ts       本地代理读 / S3 redirect 签名 URL

src/app/items/[id]/page.tsx
└── 展示绑定的 assets 列表，显示下载状态 / 链接
```

配置：`.env` 加 `ASSET_STORE=local-fs|s3`、`ASSET_STORE_PATH=/data/assets`、（s3）`ASSET_S3_BUCKET` / `ASSET_S3_ENDPOINT` / `ASSET_S3_KEY` / `ASSET_S3_SECRET`；`docker-compose.yml` 本地 FS 模式下挂卷 `./data/assets:/app/data/assets`。

验证：跑一次 video Spider，items 表写入立即，assets 表初始 `status='pending'`；几秒后 download worker 把对应 status 推进到 `ready`，文件真实落到 `data/assets/...`；`/items/[id]` 页面显示视频缩略图 + "下载" / 内联 `<video>` 播放；同一文件第二次抓时 checksum 匹配，跳过重复下载（status='skipped'）；`docker compose down && up` 重启后，正在下载的 asset 自动重试。

---

## 工作量一览

| 模块                | 实际位置                               | 工作量                                                    | 状态 |
| ------------------- | -------------------------------------- | --------------------------------------------------------- | ---- |
| 爬虫引擎            | `src/lib/crawler` + `shared`           | 引擎抽象 + Storage 接口                                   | ✅   |
| Postgres + pg-boss  | `src/lib/db` + `scripts/db-*`          | schema + 内联 SQL 迁移 + repository                       | ✅   |
| 看板 + API + Worker | `src/app` + `src/lib/worker`           | API + 看板 UI + 内置 Worker（占大头）                     | ✅   |
| Docker Compose      | 根 `Dockerfile` + compose              | 配置为主                                                  | ✅   |
| Kind 化 + 平台标记  | `src/lib/crawler/kinds` + schema 变更  | 加列 / Zod schema / 一次性 backfill（~10 个文件）         | ⏳   |
| 真平台 + 凭据管理   | `src/lib/crawler/platforms` + accounts | Platform 抽象 + 第一个平台 + accounts CRUD（~20 个文件）  | ⏳   |
| 媒体下载管道        | `src/lib/crawler/downloader` + assets  | assets 表 + 下载队列 + 至少 2 种 downloader（~15 个文件） | ⏳   |

**顺序约束：** Kind 化是凭据管理和媒体管道的前置（没有 `kind` 字段，下游无法按类型路由）。凭据管理和媒体管道之间逻辑独立，但建议先凭据后媒体：先把"抓元数据"链路打通，再加文件下载，两个新模块同时 debug 定位问题难。

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

### 待完成（多平台扩展）

- [ ] `items` 表所有行都有 `platform` / `kind` / `sourceId`，且 `(platform, sourceId)` 唯一
- [ ] 至少支持 1 个真平台（YouTube 或 B 站），能从看板创建 Run
- [ ] 至少支持 2 种资源 kind（article + video），前端按 kind 渲染
- [ ] `accounts` 表能加密存储 cookie / OAuth token，Spider Run 时正确注入
- [ ] 失败/被 ban 的 account 自动降级，看板可见
- [ ] 视频 Run 完成后，`assets` 表有对应记录，文件真实落到 AssetStore
- [ ] `download` 队列卡住 / 失败重试不影响 `crawl` 队列
- [ ] 加第三个平台时，工作量约等于复制 + 改 200 行
