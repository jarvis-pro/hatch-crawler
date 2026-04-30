# 架构总览

> 本文档描述 hatch-crawler 全栈版本的整体设计。
> 当 CLI 形态的 v0 演进为带 Web 看板的 v1，本文是所有后续决策的基线。

## 目标

把当前 CLI 爬虫升级成"可观测、可控制、可配置"的全栈应用：

- **看板**：Web UI 实时监控运行状态，可在页面上启停 Spider、调度任务、浏览结果、配置代理池等基础设施
- **持久化**：取代单机 SQLite，使用 Postgres 支持多进程并发读写
- **任务化**：每次抓取都是一个有 ID 的 Run，状态完整可追溯
- **解耦**：Web/API 与 Worker 分离，未来可水平扩展 Worker
- **一键起**：`docker compose up` 拉起完整环境，无需本地装 Postgres/Redis

## 服务拓扑

```
                     ┌──────────────┐
                     │   Browser    │
                     └──────┬───────┘
                            │ HTTP / SSE
                            ▼
                     ┌──────────────┐         ┌──────────────┐
                     │  apps/web    │  reads  │   Postgres   │
                     │  Next.js 15  │◄───────►│              │
                     │  App Router  │  writes │  spiders     │
                     │              │         │  runs        │
                     │  /api/*      │         │  items       │
                     │  /sse/logs   │         │  events      │
                     └──────┬───────┘         └──────────────┘
                            │ enqueue                ▲
                            │                        │ writes
                            ▼                        │
                     ┌──────────────┐                │
                     │    Redis     │                │
                     │  BullMQ      │                │
                     │  pub/sub     │                │
                     └──────┬───────┘                │
                            │ pull job               │
                            ▼                        │
                     ┌──────────────┐                │
                     │ apps/worker  │                │
                     │              │────────────────┘
                     │ runs spider  │
                     │ emits events │──── publish ──► Redis pub/sub
                     └──────────────┘
                            │
                            │ uses
                            ▼
                     ┌──────────────┐
                     │   packages   │
                     │   /crawler   │  ← 现有 src/ 整体迁移过来
                     │   /db        │  ← Drizzle schema + client
                     │   /shared    │  ← Zod schema、类型
                     └──────────────┘
```

## 模块职责

### `packages/crawler`

爬虫核心引擎库。原有 `src/` 整体迁移到这里，对外保持现有 API 不变：

- `Fetcher` / `UAPool` / `ProxyPool` / `HostRateLimiter`
- `UrlQueue` / `BaseSpider` / `runSpider`
- `Parsers` / 解析器工具

**重要变更**：取消 `SqliteStorage` 与 `JsonlWriter`，把存储抽象成接口 `Storage`，由调用方注入。这样 worker 可以传入 `PostgresStorage`，未来也可以注入测试用的内存实现。

```ts
export interface Storage {
  saveItem(item: CrawlItem): Promise<{ isNew: boolean }>;
  isVisited(urlHash: string): Promise<boolean>;
  markVisited(url: string, urlHash: string, spider: string): Promise<void>;
  /** 实时事件回调，每条都会被 worker 拿去广播 */
  onEvent?: (e: CrawlerEvent) => void;
}
```

### `packages/db`

Drizzle ORM + Postgres 客户端。

- `schema.ts`：所有表的定义（`spiders`、`runs`、`items`、`events`、`settings`）
- `client.ts`：`drizzle()` 工厂，根据 `DATABASE_URL` 实例化
- `migrations/`：自动生成的 SQL 迁移
- `seed.ts`：开发期种子数据

详情见 `data-model.md`。

### `packages/shared`

跨进程共享的类型与 Zod schema：

- `events.ts`：`CrawlerEvent` 联合类型（`fetched` / `emitted` / `error` / `done` 等）
- `schemas.ts`：表单 schema（创建 Run、配置代理、过滤 items）
- `constants.ts`：枚举值

### `apps/worker`

长驻进程，BullMQ 消费器：

- 启动时连接 Redis，订阅 `crawls` 队列
- 拿到 job 后实例化对应 Spider，注入 `PostgresStorage`
- 每个事件回调里：
  1. 写入 `events` 表（持久化日志）
  2. 通过 Redis pub/sub 发布到 `events:{runId}` 通道（供 SSE 实时推送）
- 完成后更新 `runs.status = 'completed'`

### `apps/web`

Next.js 15 (App Router) 全栈：

- **页面**：`/dashboard`、`/spiders`、`/runs`、`/items`、`/settings`
- **API Routes**：
  - `POST /api/runs` — 入队一个新 Run
  - `GET /api/runs` — 历史列表
  - `POST /api/runs/:id/stop` — 停止正在运行的 Run
  - `GET /api/items` — 抓取结果（分页 + 过滤）
  - `GET /api/spiders` — Spider 列表（从 `packages/crawler` 注册表读取）
  - `GET/PUT /api/settings/proxies` — 代理池增删改查
  - `GET/PUT /api/settings/ua-pool` — UA 池
- **SSE**：`GET /sse/runs/:id/logs` — 订阅某个 Run 的实时事件流

## 数据流

### 启动一次新抓取（用户在看板点 "Run"）

1. 浏览器：`POST /api/runs`（body: `{ spider: "nextjs-blog", overrides: {...} }`）
2. Web：插入一行到 `runs` 表，status = `'queued'`，并把 runId 推到 BullMQ
3. Web：返回 runId 给前端
4. 前端：跳转到 `/runs/:id`，建立 SSE 连接 `/sse/runs/:id/logs`
5. Worker：从 BullMQ 拿到 job，更新 `runs.status = 'running'`
6. Worker：实例化 Spider，每个事件：
   - 写 `events` 表
   - 发布到 Redis 通道 `events:{runId}`
7. Web 的 SSE handler：订阅 Redis 通道，把消息推给浏览器
8. Worker：完成后 `runs.status = 'completed'`，发布 `done` 事件
9. 浏览器：收到 done 后断开 SSE，刷新统计

### 浏览历史结果

1. 浏览器：`GET /api/items?spider=nextjs-blog&q=turbopack&page=1`
2. Web：直接查 Postgres，分页返回
3. 浏览器：用 TanStack Query 缓存，列表轮询（5s）

## 实时性策略

| 场景              | 方案                    | 原因                                       |
| ----------------- | ----------------------- | ------------------------------------------ |
| 单 Run 的实时日志 | **SSE**                 | 单向、流式、Next.js Route Handler 原生支持 |
| Run 列表状态刷新  | **轮询 5s**             | 数据量小、变化频次低，简单可靠             |
| Items 列表        | **轮询 10s 或手动刷新** | 用户主动浏览，不需要秒级更新               |
| Settings 变更     | **不需要实时**          | 表单 submit 后 invalidate 即可             |

## 部署拓扑（Docker Compose）

```yaml
services:
  postgres: # 数据持久化
  redis: # BullMQ + pub/sub
  web: # apps/web (Next.js)
  worker: # apps/worker
```

详见 `docs/roadmap.md` Phase 5。

## 安全与认证

**v1 范围内不做认证**。Compose 环境默认绑定 `127.0.0.1`，假设是单用户本地运行。
未来加 auth 时建议：

- NextAuth（Credentials Provider）+ Postgres adapter
- API Routes 加 middleware 校验 session
- Worker 不暴露端口，只通过内部网络通信

## 关键设计权衡

| 问题     | 选择               | 替代方案            | 取舍理由                                                    |
| -------- | ------------------ | ------------------- | ----------------------------------------------------------- |
| 数据库   | Postgres           | SQLite / MongoDB    | 多进程下 SQLite 写锁竞争；Mongo 对结构化分析弱              |
| 队列     | BullMQ + Redis     | 内存队列 / pg-boss  | BullMQ 自带调度/重试/死信/UI；pg-boss 多一层选择负担        |
| ORM      | Drizzle            | Prisma / TypeORM    | Drizzle 是 TS 原生 schema-as-code，无生成步骤、运行时零反射 |
| UI 库    | shadcn/ui          | MUI / Antd          | shadcn 复制式集成、可改、和 Tailwind 协作好                 |
| 实时     | SSE                | WebSocket           | SSE 简单、自动重连、单向就够用                              |
| 前端框架 | Next.js App Router | Vite SPA + 独立 API | 一体化、文件路由、Server Component 减少 boilerplate         |

## 边界与"不做"清单

- ❌ 不做认证（v2 再加）
- ❌ 不做多用户隔离
- ❌ 不做分布式 Worker（一个 Worker 实例够用，BullMQ 留好横向扩展能力即可）
- ❌ 不做 K8s（Compose 满足"本地一键起"需求）
- ❌ 不做 Playwright 浏览器渲染（v1 仍然只走 HTTP，Next.js **NEXT_DATA** 是核心）
- ❌ 不做插件式 Spider 加载（Spider 仍然是 TS 代码，重启 Worker 才生效）
