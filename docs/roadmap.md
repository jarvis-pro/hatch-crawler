# 实施路线

> 把全栈化拆成 4 个 Phase。早期方案曾计划 pnpm workspace + monorepo（`packages/*` + `apps/*`），
> 后期收敛为单仓 Next.js 应用，源码集中在 `src/`。下面以 v1 实际落地形态描述。
> v1 范围内 4 个 Phase 已全部交付，本文同时充当"现在每块在哪儿"的速查。

## Phase 1 — 抽离 crawler 引擎模块 ✅

**目标：** 把 v0 的 CLI 爬虫拆出独立的"引擎库"边界，让上层（CLI / Worker / smoke）都能复用。

**交付：**

- `src/lib/crawler/`：core / middleware / parsers / spiders / storage / utils / config
- `src/lib/shared/`：`CrawlerEvent` 等跨层共享类型
- `Storage` 接口 + 内存 / file / SQLite 实现（脱机调试）
- `scripts/smoke.ts`：内存 Storage 跑一遍示例 Spider，作为引擎自测入口

> 早期方案中的 `apps/cli` 已不存在；CLI 形态的 v0 已经被看板取代。

---

## Phase 2 — Postgres 持久化 + pg-boss 队列 ✅

**目标：** 数据层立起来，能本地连 Postgres，跑通 schema 迁移；pg-boss 队列就绪。

**交付：**

```
src/lib/db/
├── schema.ts              所有业务表 Drizzle 定义
├── client.ts              drizzle() / postgres-js 单例
├── boss.ts                pg-boss 客户端单例 + queue 名常量
├── migrate.ts             runMigrations(): 内联 SQL 幂等建表 + boss.start() 自建 pgboss schema
├── repositories/          runs / items / events / settings / spiders / visited
└── index.ts               re-export

scripts/
├── db-migrate.ts          手动迁移入口（pnpm db:migrate）
└── db-seed.ts             种子数据（pnpm db:seed）

drizzle.config.ts          drizzle-kit（generate / studio）配置
```

**新增依赖：** `drizzle-orm`、`drizzle-kit`、`postgres`、`pg-boss`。

**验证：**

```bash
docker compose up postgres -d
DATABASE_URL=postgres://hatch:hatch@localhost:5432/hatch pnpm db:migrate
DATABASE_URL=...                                       pnpm db:seed
psql $DATABASE_URL -c "\dt"          # 业务表
psql $DATABASE_URL -c "\dt pgboss.*" # pg-boss 队列表
```

---

## Phase 3 — 看板 + API + SSE + 内置 Worker ✅

**目标：** Web UI、API、SSE、内置 pg-boss worker 全部到位，浏览器里完成
`docs/dashboard-spec.md` 中的所有用户旅程。

**交付：**（与早期方案对照，所有 `apps/web/*` 路径已合并到根 `src/*`）

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

> stale-run cleanup 与 SSE 订阅的内存通道都在 `src/lib/worker/` 内部完成，未单独拆文件。

**新增依赖：**

- `next` 15+, `react` 19+
- `tailwindcss`, `class-variance-authority`, `clsx`, `tailwind-merge`
- `lucide-react`、`@tanstack/react-query`
- `react-hook-form`, `@hookform/resolvers`, `zod`
- `sonner`（toast）
- shadcn 的若干组件

**验证：**

```bash
docker compose up postgres -d
DATABASE_URL=... pnpm dev
# 浏览器打开 http://localhost:3000 走完 docs/dashboard-spec.md 所有页面
```

---

## Phase 4 — Docker Compose 一键起 ✅

**目标：** 干净机器上 `git clone && docker compose up` 能跑。

**交付：**

```
Dockerfile                  根目录单一 Dockerfile（多阶段：deps → builder → runner）
docker-compose.yml          postgres + web 两个服务
.dockerignore
.env.docker.example
docs/deployment.md
```

**`docker-compose.yml` 形态：**

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
      - "127.0.0.1:5432:5432"
    healthcheck:
      test:
        [
          "CMD-SHELL",
          "pg_isready -U $${POSTGRES_USER:-hatch} -d $${POSTGRES_DB:-hatch}",
        ]

  web:
    build:
      context: .
      dockerfile: Dockerfile
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-hatch}:${POSTGRES_PASSWORD:-hatch}@postgres:5432/${POSTGRES_DB:-hatch}
      NODE_ENV: production
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      postgres: { condition: service_healthy }

volumes:
  pg_data:
```

只有 **2 个服务**。

**Dockerfile 策略：**

- 多阶段构建（`deps` / `builder` / `runner`）
- `node:22-alpine` 基镜像
- `pnpm install --frozen-lockfile` → `pnpm build` → 复制 `.next/standalone`
- runner 用非 root `nextjs` 用户启动 `node server.js`

**验证：**

```bash
docker compose up --build
open http://localhost:3000
```

---

## 阶段间依赖

```
Phase 1 (engine) ──► Phase 2 (db) ──► Phase 3 (web+worker) ──► Phase 4 (compose)
              ✅              ✅                       ✅                    ✅
```

线性、串行；v1 整体已完成。

## 估算（事后回看）

| Phase | 实际位置                      | 工作量                                |
| ----- | ----------------------------- | ------------------------------------- |
| 1 ✅  | `src/lib/crawler` + `shared`  | 引擎抽象 + Storage 接口               |
| 2 ✅  | `src/lib/db` + `scripts/db-*` | schema + 内联 SQL 迁移 + repository   |
| 3 ✅  | `src/app` + `src/lib/worker`  | API + 看板 UI + 内置 Worker（占大头） |
| 4 ✅  | 根 `Dockerfile` + compose     | 配置为主                              |

## 验收清单（v1 完成的标志）

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
