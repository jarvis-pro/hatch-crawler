# 架构总览

> 本文档描述 hatch-crawler 当前的整体设计——单仓 Next.js 应用（不使用 pnpm workspace + monorepo），Web 看板 + 后台 Worker 同进程。
> 改重大模块前请先在 [`../rfcs/`](../rfcs/) 立项；本文记录"现在是什么"，RFC 记录"为什么这么定"。

## 目标

把 CLI 爬虫升级成"可观测、可控制、可配置"的全栈应用：

- **看板**：Web UI 实时监控运行状态，可在页面上启停 Spider、调度任务、浏览结果、配置代理池等基础设施
- **持久化**：取代单机 SQLite，使用 Postgres
- **任务化**：每次抓取都是一个有 ID 的 Run，状态完整可追溯
- **一键起**：`docker compose up` 拉起完整环境，无需本地装 Postgres

## 关键决策：合并部署（不分 Web / Worker）

> 当前把"Web/API"和"Worker"塞在同一个 Next.js 进程里，
> 通过 [pg-boss](https://github.com/timgit/pg-boss) 用 Postgres 做任务队列。
> **不需要单独的 Worker 进程，也不需要 Redis。**

为什么不分进程：

| 维度      | 项目实际定位（学习 / 单用户 / 本地） | 分进程能带来的价值 |
| --------- | ------------------------------------ | ------------------ |
| 并发用户  | 1                                    | 可被多个 user 共享 |
| 部署形态  | Docker Compose 本地                  | 可独立扩缩容       |
| Worker 数 | 1 实例就够                           | 可横向 +N          |
| 故障域    | Web 死了重启即可                     | 隔离爬取任务       |

所以分进程的好处对这个项目用不上，代价（多容器、多组件、IPC 复杂度）反而是真的。一个进程里跑掉是更合适的形态。

未来要拆，把 pg-boss 的 worker 抽到独立进程并不困难——保留这个可能性即可。

## 服务拓扑

```
                ┌──────────────┐
                │   Browser    │
                └──────┬───────┘
                       │ HTTP / SSE
                       ▼
                ┌──────────────────────────────┐
                │  Next.js 15 (单一进程)       │
                │                              │
                │  路由层  /dashboard, /runs.. │
                │  API     /api/*              │
                │  SSE     /sse/runs/:id/logs  │
                │                              │
                │  ─ src/instrumentation.ts ─  │
                │  pg-boss Worker  (同进程)    │
                │  EventBus        (同进程)    │
                │  src/lib/crawler (引擎)      │
                └──────────────┬───────────────┘
                               │ SQL
                               ▼
                       ┌──────────────┐
                       │   Postgres   │
                       │              │
                       │  spiders     │ ← 业务表
                       │  runs        │
                       │  items       │
                       │  events      │
                       │  visited     │
                       │  settings    │
                       │              │
                       │  pgboss.*    │ ← pg-boss 自带表（队列 / 调度）
                       └──────────────┘
```

只有 **2 个容器**：`postgres` + `web`。

## 模块职责

整个项目是一个 Next.js 应用，源码在 `src/`。下面按目录拆分职责。

### `src/lib/crawler` — 爬虫核心引擎

```
src/lib/crawler/
├── core/        Fetcher / UrlQueue / Scheduler / BaseSpider + runSpider
├── middleware/  proxy-pool / ua-pool / host rate-limiter
├── parsers/     next-data-parser / html-parser
├── spiders/     内置示例 Spider（如 nextjs-blog-spider）
├── storage/     Storage 接口 + 内存 / file / SQLite 实现（脱机调试用）
├── utils/       logger / url
├── config/      运行时配置组装
└── index.ts     对外公共导出
```

引擎层与具体存储/队列解耦：worker 在 `src/lib/worker/` 注入 `PostgresStorage`，
smoke 测试在 `scripts/smoke.ts` 注入内存 Storage。

### `src/lib/db` — Prisma ORM + pg-boss 客户端

```
src/lib/db/
├── client.ts        PrismaClient 单例（dev HMR 守卫）
├── boss.ts          pg-boss 客户端单例 + queue 名称常量
├── migrate.ts       runMigrations(databaseUrl)：内联 SQL，幂等可重入
├── repositories/    runs / items / events / settings / spiders / visited
└── index.ts         re-export + 业务实体类型（收紧 jsonb 列）
```

> Prisma 的权威 schema 在仓库根的 `prisma/schema.prisma`；`pnpm db:generate` = `prisma generate` 刷新生成的 client 类型。
> pg-boss 的队列表由 `boss.start()` 在 `pgboss` schema 自动建出，不在我们手写的 SQL 里。
> 业务表由 `migrate.ts` 中的 `CREATE TABLE IF NOT EXISTS` 内联 SQL 创建，与 `schema.prisma` 保持手工同步；
> 严格 schema 演进（多人协作 / 生产部署）时再切到 `prisma migrate dev` / `prisma migrate deploy`。

详情见 [`../reference/data-model.md`](../reference/data-model.md)。

### `src/lib/worker` — 进程内 pg-boss worker

```
src/lib/worker/
├── index.ts            startWorker() / 优雅关停 / 单例守卫
├── job-handler.ts      单个 crawl job 的执行：取 Spider、注入 Storage、串事件流
├── postgres-storage.ts 实现 crawler Storage 接口（写入 items / visited 表）
└── event-bus.ts        进程内 EventBus（runId → channel），SSE handler 订阅
```

### `src/lib/shared` — 跨模块共享类型

```
src/lib/shared/
├── events.ts   CrawlerEvent 联合类型
└── index.ts
```

### `src/lib/`（其他）

- `api-client.ts` — 浏览器调 `/api/*` 的封装
- `query-client.ts` — TanStack Query 配置
- `spider-registry.ts` — Spider 名 → 类的映射，供 worker 反查
- `env.ts` — 环境变量校验
- `api/response.ts` — API Route 统一响应包装
- `utils.ts` — `cn()` 等通用工具

### `src/app` — Next.js App Router

```
src/app/
├── layout.tsx / providers.tsx / globals.css
├── (dashboard) /dashboard/page.tsx
├── /spiders/page.tsx + /spiders/[name]/page.tsx
├── /runs/page.tsx + /runs/[id]/page.tsx
├── /items/page.tsx + /items/[id]/page.tsx
├── /settings/page.tsx
├── api/
│   ├── spiders/route.ts、spiders/[name]/route.ts
│   ├── runs/route.ts、runs/[id]/{route,stop,events}/route.ts
│   ├── items/route.ts、items/[id]/route.ts
│   ├── settings/[key]/route.ts
│   └── stats/summary/route.ts
└── sse/runs/[id]/logs/route.ts
```

### `src/components` — React 组件

```
src/components/
├── ui/      shadcn 基础组件（badge / button / card / dialog / input / table / tabs）
├── nav/     sidebar / topbar
├── runs/    run-status-badge / new-run-dialog / live-log-stream
├── items/   json-viewer
└── stats/   stats-card
```

### `src/instrumentation.ts`

Next.js 进程启动钩子。在 Node runtime 下：

1. 调 `runMigrations(DATABASE_URL)` 建业务表 + pgboss schema
2. 调 `startWorker()` 拉起 pg-boss worker，开始消费 `crawl` 队列

## 数据流

### 启动一次新抓取（用户在看板点 "Run"）

1. 浏览器：`POST /api/runs`
2. API handler：插入 `runs` 表（status = `'queued'`），调用 `pgboss.send('crawl', { runId, ... })`
3. 返回 runId 给前端
4. 前端：跳到 `/runs/:id`，建立 SSE 连接 `/sse/runs/:id/logs`
5. **同进程内**的 pg-boss worker 拉到 job：
   - 更新 `runs.status = 'running'`
   - 实例化 Spider（通过 `src/lib/spider-registry.ts`），注入 `PostgresStorage`
   - 每个 `CrawlerEvent`：写 `events` 表 + 推到内存 EventBus
6. SSE handler 订阅 EventBus 上 `runId` 的频道，把消息推给浏览器
7. 完成后：`runs.status = 'completed'` + EventBus 发 `done`
8. 浏览器收到 `done`，断开 SSE，刷新统计

### 浏览历史结果

1. 浏览器：`GET /api/items?spider=...&q=...&page=1`
2. Web：直接查 Postgres，分页返回
3. 浏览器：TanStack Query 缓存 + 5s 轮询

## 实时性策略

| 场景              | 方案                    | 原因                                                |
| ----------------- | ----------------------- | --------------------------------------------------- |
| 单 Run 的实时日志 | **SSE + 内存 EventBus** | 单进程下不需要 Redis pub/sub，直接订阅 EventEmitter |
| Run 列表状态刷新  | 轮询 5s                 | 简单可靠                                            |
| Items 列表        | 轮询 10s                | 用户主动浏览                                        |
| Settings 变更     | 不需要实时              | 表单 submit 后 invalidate 即可                      |

## 部署拓扑（Docker Compose）

```yaml
services:
  postgres: # 数据 + pg-boss 队列
  web: # Next.js + 内置 worker（同一镜像，根 Dockerfile 构建）
```

详见 [`../deploy/deployment.md`](../deploy/deployment.md) 与 [`roadmap.md`](./roadmap.md) Phase 4。

## 进程内任务的几个边界处理

- **冷启动 stale-run 清理**：进程启动时扫一遍 `runs` 表，把 `running` 状态但已经超过 N 分钟没更新的 run 标为 `failed`，避免假"在跑"
- **优雅关停**：收到 SIGTERM 时，先暂停 pg-boss、等当前 job 完成（带超时），再退出
- **Next.js dev 热重载**：用 `globalThis` 守卫 worker / EventBus 单例，避免 HMR 时重复注册

## 安全与认证

**当前不做认证**。Compose 默认绑定 `127.0.0.1`，假设单用户本地运行。

未来加 auth 时建议：

- NextAuth（Credentials Provider）+ Postgres adapter
- API Routes 加 middleware 校验 session

## 关键设计权衡

| 问题     | 选择               | 替代方案            | 取舍理由                                         |
| -------- | ------------------ | ------------------- | ------------------------------------------------ |
| 数据库   | Postgres           | SQLite / MongoDB    | 单写多读够用，jsonb 友好                         |
| 队列     | pg-boss            | BullMQ + Redis      | 少一个组件；够用                                 |
| ORM      | Prisma             | Drizzle / TypeORM   | 团队熟悉度高；CLI 工具链成熟（migrate / studio） |
| UI 库    | shadcn/ui          | MUI / Antd          | 复制式集成、和 Tailwind 协作好                   |
| 实时     | SSE                | WebSocket           | 单向就够                                         |
| 前端框架 | Next.js App Router | Vite SPA + 独立 API | 一体化，路由 + Server Component 减少胶水         |
| 进程拓扑 | **单进程合并**     | 独立 web + worker   | 学习项目，简单优先；保留未来拆分余地             |
| 仓库布局 | **单 package**     | pnpm workspace 拆包 | 没有跨包复用需求；扁平化更易学                   |

## 边界与"不做"清单

- ❌ 不做认证（下一阶段再加）
- ❌ 不做多用户隔离
- ❌ 不做独立 Worker 进程（当前单进程；未来需要时再拆）
- ❌ 不做 Redis（pg-boss 用 Postgres 做队列，省一个组件）
- ❌ 不做 K8s（Compose 满足"本地一键起"需求）
- ❌ 不做 Playwright 浏览器渲染（当前只走 HTTP，Next.js `__NEXT_DATA__` 是核心）
- ❌ 不做插件式 Spider 加载（Spider 仍然是 TS 代码，重启 Web 才生效）
- ❌ 不做 CLI（整个交互通过看板；引擎自测用 `pnpm smoke`）
- ❌ 不做 monorepo（早期方案考虑过 `packages/*` + `apps/web`，最终扁平化为单 package）

---

## 下一阶段提案：多平台 / 多资源类型扩展（提案中，未实施）

> 完整提案见 [`../rfcs/0001-multi-platform.md`](../rfcs/0001-multi-platform.md)。这里只列**架构层**的演进要点，
> 让本文继续作为"全貌入口"。提案落地分 Phase 5/6/7（详见 [`roadmap.md`](./roadmap.md)），现有代码不动。

### 演进的核心：四层抽象

把当前"一个 `Spider` 类全包"裂成 4 个正交层：

| 层                | 描述                                                | 物理位置                                 |
| ----------------- | --------------------------------------------------- | ---------------------------------------- |
| **Platform**      | 这家网站长啥样：fetch 策略 / 鉴权 / 签名 / 反爬偏好 | `src/lib/crawler/platforms/<platform>/`  |
| **Spider**        | 在某平台上的一种入口策略：起点 + 遍历 + enqueue     | `src/lib/crawler/platforms/<p>/spiders/` |
| **Resource Kind** | 抓到的是什么：video / audio / image / article / ... | `src/lib/crawler/kinds/<kind>.ts` (Zod)  |
| **Pipeline**      | 元数据 / 媒体 / 后处理 三条独立队列                 | pg-boss `crawl` / `download` / `enrich`  |

每加一个平台：写 1 份 Platform + 若干 Spider，不动核心。
每加一个资源类型：写 1 份 Zod schema + 前端一段渲染。

### 演进后的服务拓扑

```
                 ┌──────────────┐
                 │   Browser    │
                 └──────┬───────┘
                        │
                        ▼
        ┌──────────────────────────────────────┐
        │  Next.js 进程                         │
        │                                      │
        │  routes / api / sse                  │
        │  ─ src/instrumentation.ts ─          │
        │  pg-boss workers (同进程，多队列)：   │
        │    crawl    → src/lib/worker/crawl-* │
        │    download → src/lib/worker/dl-*    │
        │    enrich   → src/lib/worker/enrich-*│
        │  AssetStore（local FS / S3）          │
        └──────┬──────────────────────┬────────┘
               │ SQL                  │ blob
               ▼                      ▼
       ┌──────────────┐       ┌──────────────┐
       │   Postgres   │       │ Object Store │
       │              │       │              │
       │  + assets    │       │  /assets/... │
       │  + accounts  │       └──────────────┘
       └──────────────┘
```

容器数仍是 **2 个**（`postgres` + `web`），可选第 3 个：`minio` / S3-兼容对象存储（生产环境）。

### 新增模块要点

- `src/lib/crawler/platforms/`：每平台一个子目录，导出 `Platform` 描述对象 + 共享 helper
- `src/lib/crawler/kinds/`：每种资源类型一份 Zod schema，所有 Spider `emit` 必须通过校验
- `src/lib/crawler/fetcher/`：从单文件升级为多策略（http / playwright / api）；Playwright 默认不启动
- `src/lib/crawler/downloader/`：媒体下载器（http-stream / hls / yt-dlp 兜底）
- `src/lib/worker/asset-store.ts`：`AssetStore` 接口 + `LocalFsStore` / `S3Store` 实现
- `src/lib/worker/download-handler.ts`：消费 `download` 队列
- `prisma/schema.prisma`：加 `platform` / `kind` / `sourceId` 列，新增 `Asset` / `Account` model

### 数据流（演进后）

新增"媒体下载"分支：

1. 浏览器 `POST /api/runs` （同当前实现）
2. crawl worker 跑 Spider，emit `ResourceItem`（含 `media[]`）
3. crawl worker 写 `items` 表后，按 `media[]` 推 N 个 `download` job
4. download worker 拉文件 → 写对象存储 → 更新 `assets.status='ready'`
5. 看板 `/items/[id]` 同时展示元数据 + 已 ready 的媒体文件列表

### 设计权衡（增量）

| 问题               | 选择                              | 替代方案              | 取舍理由                             |
| ------------------ | --------------------------------- | --------------------- | ------------------------------------ |
| 资源类型建模       | **统一 items + kind + Zod**       | 每类型一张表          | 加新类型不动 schema                  |
| 媒体下载耦合       | **拆 download 队列**              | Spider 内联下载       | 防 Spider 阻塞、节流分级             |
| 媒体存储           | **AssetStore 接口（local / S3）** | 直接二进制入 Postgres | jsonb 不适合存 GB 级二进制           |
| 凭据管理           | **accounts 表 + 加密 payload**    | 环境变量 / 硬编码     | 多账号轮换、ban 检测、看板可视化     |
| Platform vs Spider | **拆两层**                        | 一个 class 全包       | 加新平台是 O(1) 工作量，不用改老平台 |

### 边界（仍然不做）

- ❌ 不做视频转码 / OCR / ASR（落 raw 媒体即可，后续 enrich 队列单独迭代）
- ❌ 不做内容版权 / 付费墙绕过（用户提供合法凭据除外）
- ❌ 不做实时 WebSocket 推送新 item（继续 SSE / 轮询）
- ❌ 不做媒体 CDN 回源（看板自己代理本地 FS / 或 S3 redirect 签名 URL）
