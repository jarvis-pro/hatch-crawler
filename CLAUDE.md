# CLAUDE.md

> 给 Claude / AI 编码代理读的项目说明书。改代码前先扫一遍这份文件，能省下大量翻仓的时间。
> 人类读者请先看 `README.md` 和 `docs/getting-started/architecture.md`。

## 项目一句话

`hatch-crawler` 是一个面向 Next.js 站点优化的全栈爬虫：
**单仓 Next.js 15 应用** = 浏览器看板 + REST API + SSE 实时日志 + 进程内 pg-boss worker，
共享同一个 Postgres，`docker compose up` 一键起。

## 技术栈速查

| 维度     | 选型                                                           |
| -------- | -------------------------------------------------------------- |
| 运行时   | **Node.js 22+**（`.nvmrc` 锁定）                               |
| 包管理   | **pnpm 10**（`packageManager` 锁定，禁止用 npm/yarn）          |
| 框架     | Next.js 15 App Router + React 19 + Turbopack（dev）            |
| 类型     | TypeScript 5.6 strict + `noUncheckedIndexedAccess`             |
| 数据库   | PostgreSQL（业务表 + `pgboss` schema 共库）                    |
| ORM      | **Prisma 5**（`@/prisma/schema.prisma` 是权威）                |
| 任务队列 | **pg-boss 10**（用 Postgres 做队列，不引 Redis）               |
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
pnpm typecheck         # tsc --noEmit
pnpm lint / lint:fix
pnpm format / format:check

pnpm db:generate       # prisma generate（改完 schema.prisma 必跑）
pnpm db:migrate        # 跑 src/lib/db/migrate.ts（开发期手动；生产由 instrumentation 自动）
pnpm db:seed           # 灌示例 Spider + 默认 settings
pnpm db:studio         # prisma studio

pnpm smoke             # 引擎烟雾测试，内存 Storage，不依赖 DB
```

起本地环境：

```bash
docker compose up postgres -d
DATABASE_URL=postgres://hatch:hatch@localhost:5432/hatch pnpm dev
```

## 架构必须知道的几件事

### 1. 单进程合并部署：Web + Worker 同进程

Web/API 和 pg-boss worker 跑在**同一个 Next.js 进程**。
`src/instrumentation.ts` 在进程启动时：

1. `runMigrations(DATABASE_URL)` —— 跑业务表 DDL
2. `startWorker()` —— 拉起 pg-boss worker，订阅 `crawl` 队列

不要为了"扩展性"擅自把 worker 拆出去。要拆请先在 `docs/rfcs/` 立项。

### 2. Prisma 和 pg-boss 是互补的，不要混淆

| 工具        | 管什么                                      | 表在哪                      |
| ----------- | ------------------------------------------- | --------------------------- |
| **Prisma**  | 业务实体读写：spiders / runs / events / ... | public schema，业务表       |
| **pg-boss** | 任务派发、重试、cron、并发控制              | `pgboss` schema，**自管表** |

- 业务表的 schema 在 `prisma/schema.prisma`，**但 DDL 写在 `src/lib/db/migrate.ts` 里手工 `CREATE TABLE IF NOT EXISTS`**（保持与 schema.prisma 手动同步）。改字段时两边都要改。
- pg-boss 的表由 `boss.start()` 自动建在 `pgboss` schema，**不要手工去碰**。
- 严格演进（多人/生产）时再切到 `prisma migrate dev/deploy`，目前还没切。

### 3. 数据流（启动一次抓取）

```
浏览器 POST /api/runs
  → 插入 runs 行（status=queued）
  → pgboss.send('crawl', { runId, spider, overrides })
  → 返回 runId
浏览器 SSE /sse/runs/:id/logs
  ↑                       ↓ 同进程 EventBus
worker 拉到 job
  → updateRun running
  → spider-registry 取 Spider 类
  → 注入 PostgresStorage（写 items / visited 表）
  → 每个 CrawlerEvent：写 events 表 + EventBus 推到 SSE
  → 完成后 updateRun completed + EventBus.done
```

### 4. 停止运行靠内存 AbortController

`abortRun(runId)` 走 `globalThis` 上的 abort 表，**不经过 EventBus、不经过 pg-boss**。
（POST `/api/runs/:id/stop` → `abortRun(runId)` → 当前 job 收到 AbortSignal 自行清理。）
单进程下这样最简单；将来拆 worker 时这块要换实现。

### 5. globalThis 单例守卫

Next.js dev 模式 HMR 会反复 import 模块。所有"全局只能有一个"的对象都用 `globalThis` 守卫，
不要破坏这个模式：

- `src/lib/db/client.ts` — PrismaClient
- `src/lib/db/boss.ts` — pg-boss 实例
- `src/lib/worker/index.ts` — worker 启动状态 + abortControllers Map

### 6. server-only 边界

只能在 server 跑的模块顶部都写了 `import 'server-only'`：`env.ts`、`worker/*`。
新加 server-only 工具时也加上，避免被前端 bundle 误引用。

## 模块地图（src/）

```
src/
├── app/                           Next.js App Router
│   ├── api/                       REST：spiders / runs / items / settings / stats
│   ├── sse/runs/[id]/logs/        SSE 实时日志
│   └── (页面) dashboard / spiders / runs / items / settings
├── components/
│   ├── ui/                        shadcn/ui（直接编辑，不是 npm 包）
│   ├── nav/ runs/ items/ stats/   业务组件
├── lib/
│   ├── crawler/                   爬虫引擎（与存储/队列解耦）
│   │   ├── core/                  Fetcher / UrlQueue / Scheduler / BaseSpider
│   │   ├── middleware/            proxy-pool / ua-pool / rate-limiter
│   │   ├── parsers/               next-data-parser / html-parser
│   │   ├── spiders/               内置 Spider 实现
│   │   ├── storage/               Storage 接口 + 内存/file/SQLite 实现（脱机调试用）
│   │   └── utils/ config/
│   ├── db/                        Prisma + pg-boss 客户端 + 仓储层
│   │   ├── client.ts              PrismaClient 单例
│   │   ├── boss.ts                pg-boss 单例 + QUEUE_CRAWL 常量 + CrawlJobData
│   │   ├── migrate.ts             业务表 DDL（手写，幂等）
│   │   ├── repositories/          runs / items / events / settings / spiders / visited
│   │   └── index.ts               公开 API + 业务实体类型（收紧 jsonb）
│   ├── worker/                    pg-boss worker（同进程）
│   │   ├── index.ts               startWorker / abortRun
│   │   ├── job-handler.ts         单个 crawl job 的执行
│   │   ├── postgres-storage.ts    crawler Storage 接口的 PG 实现
│   │   └── event-bus.ts           runId → channel 的内存 EventBus
│   ├── shared/                    跨模块类型（CrawlerEvent 等）
│   ├── api/response.ts            API 统一响应包装
│   ├── api-client.ts              前端调 API 的封装
│   ├── query-client.ts            TanStack Query 配置
│   ├── spider-registry.ts         name → Spider 类的映射
│   ├── env.ts                     环境变量懒校验
│   └── utils.ts                   cn() 等
└── instrumentation.ts             Next.js 启动钩子：跑迁移 + 起 worker
```

## 项目惯例

- **注释和文档主要用中文**（README、docs/、代码注释都是中文），保持一致。
- **路径别名只用 `@/`**，不要写 `../../../`。
- **数据库命名**：表名、列名 snake*case（用 Prisma 的 `@map` / `@@map`），索引 `idx*<table>_<cols>`，唯一索引 `uniq_<...>`。
- **jsonb 列**：在 `src/lib/db/index.ts` 把 Prisma 的 `JsonValue` 收紧成业务类型（如 `Spider.startUrls: string[]`）。新增 jsonb 字段记得跟着加。
- **API 响应**：所有 `app/api/**/route.ts` 用 `src/lib/api/response.ts` 的 `ok()` / `fail()` 包装，不要直接 `NextResponse.json`。
- **不直接读 `process.env`**：通过 `src/lib/env.ts` 的 `env` 取值（懒校验，缺值才抛）。
- **better-sqlite3 是 onlyBuiltDependencies 白名单**（pnpm 10 默认不跑 native postinstall）。生产路径走 Postgres，SQLite 只是 storage 模块的脱机调试备胎。
- **提交规范**：Conventional Commits（commitlint 中文 subject 已开），`pre-commit` 会对暂存文件跑 prettier，`commit-msg` 校验格式。

## 写一个新 Spider

1. 新建 `src/lib/crawler/spiders/<name>.ts`，继承 `BaseSpider`，实现 `parse(ctx)`。
2. 在 `src/lib/spider-registry.ts` 把类映射到 `name` —— **worker 靠这个反查类**。
3. 在 `scripts/db-seed.ts` 写默认配置，或起服务后在看板 `/spiders` 手工创建一行。
4. 验证：`pnpm smoke`（纯引擎，不入库）→ 看板"立即运行"（完整链路）。

`parse` 里能用的：

- `ctx.response.body` —— HTML
- `extractNextData(body)` —— 提取 `__NEXT_DATA__`
- `ctx.emit({ url, type, payload })` —— 出 item
- `ctx.enqueue({ url, type })` —— 加新 URL 入队

## 改 schema 的标准动作

1. 改 `prisma/schema.prisma`
2. **同步**改 `src/lib/db/migrate.ts` 的 DDL
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

- 不要把 worker 拆到独立进程（除非先在 `docs/rfcs/` 立 RFC）。
- 不要引 Redis —— pg-boss 的全部价值就是不要 Redis。
- 不要直接 `new PrismaClient()` / `new PgBoss()` —— 一律走 `getDb()` / `getBoss()` 单例。
- 不要在 client 组件里 import `src/lib/worker/*`、`src/lib/db/*`、`src/lib/env.ts`（server-only）。
- 不要绕过 `src/lib/api/response.ts` 自己拼 API JSON。
- 不要手动 `INSERT INTO pgboss.*` —— 那是 pg-boss 自管的。
- 不要把 `prisma/schema.prisma` 当唯一 schema 来源 —— `migrate.ts` 也必须同步改。

## 想深入？读这些

- 架构与决策：`docs/getting-started/architecture.md`
- 数据模型：`docs/reference/data-model.md`
- API 契约：`docs/reference/api-spec.md`
- 看板线框：`docs/reference/dashboard-spec.md`
- 部署：`docs/deploy/deployment.md`
- 重大变更：`docs/rfcs/`（先开 RFC 再动）
