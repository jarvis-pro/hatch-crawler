# 实施路线

> 把全栈化拆成 5 个 Phase，每个 Phase 都能独立验证。
> 一个 Phase 完成了再开下一个，避免大坨改动一次性掉河。

## Phase 1 — 转 monorepo + 抽离 crawler 包

**目标：** 现有 CLI 还能跑，但代码结构变成 workspace。

**新增 / 修改的文件：**

```
pnpm-workspace.yaml          [新增]
package.json                 [改：根 workspace package.json]
tsconfig.base.json           [新增：所有子项目共享的 base]
packages/
├── crawler/
│   ├── package.json         [新增]
│   ├── tsconfig.json        [新增 extends ../../tsconfig.base.json]
│   └── src/                 [从根 src/ 整体迁过来]
│       ├── ... 现有所有文件 ...
│       └── storage.ts       [新增：Storage 接口；保留 SqliteStorage 作为 v0 实现，标 @deprecated]
└── shared/
    ├── package.json         [新增]
    └── src/
        ├── events.ts        [新增：CrawlerEvent 联合类型]
        └── index.ts
apps/
└── cli/                     [新增：原 src/index.ts 迁到这里，保留 CLI 形态]
    ├── package.json
    └── src/index.ts
```

**关键改动：**

1. `packages/crawler` 不再依赖具体的 SQLite 实现，对外只暴露 `Storage` 接口
2. `packages/shared` 提供 `CrawlerEvent` 类型，给 worker 与 web 共用
3. `apps/cli` 保留 CLI 入口，引入 `packages/crawler` + `SqliteStorage`，行为与 v0 等价

**验证：**

```bash
pnpm install
pnpm --filter @hatch-crawler/cli crawl   # 等价于原来的 pnpm crawl，结果在 data/ 下
pnpm --recursive typecheck
pnpm --recursive lint
```

---

## Phase 2 — packages/db (Drizzle + Postgres)

**目标：** 数据层立起来，能本地连 Postgres，跑通 schema 迁移。

**新增文件：**

```
packages/db/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── src/
│   ├── schema.ts            [按 docs/data-model.md 写所有表]
│   ├── client.ts            [drizzle() 工厂]
│   ├── index.ts             [re-export]
│   └── repositories/
│       ├── runs.ts          [createRun, updateRunStats, listRuns, ...]
│       ├── items.ts
│       ├── events.ts
│       ├── settings.ts
│       └── visited.ts
├── migrations/              [drizzle-kit 自动生成]
└── scripts/
    ├── migrate.ts           [启动时调用]
    ├── seed.ts              [开发期种子数据]
    └── migrate-from-sqlite.ts  [从 v0 SQLite 迁数据]
```

**新增依赖：**

- `drizzle-orm`
- `drizzle-kit` (dev)
- `postgres`（postgres.js 驱动）

**验证：**

1. 跑 `docker run -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16` 起一个 Postgres
2. `pnpm --filter @hatch-crawler/db migrate`
3. `pnpm --filter @hatch-crawler/db seed`
4. 用 `psql` 看表都建出来了，`spiders` 里有示例数据

---

## Phase 3 — apps/worker (BullMQ 消费器)

**目标：** Worker 能从队列拉 job、跑 spider、写库、发布事件。

**新增文件：**

```
apps/worker/
├── package.json
├── tsconfig.json
├── Dockerfile
└── src/
    ├── index.ts             [启动入口，连 Redis + Pg]
    ├── postgres-storage.ts  [实现 packages/crawler 的 Storage 接口]
    ├── job-handler.ts       [一个 job 的执行逻辑]
    ├── spider-registry.ts   [name → Spider 类的映射]
    ├── event-bridge.ts      [crawler event → 写 events 表 + 发布到 Redis]
    └── stop-listener.ts     [订阅 stop:{runId}，触发 AbortController]
```

**新增依赖：**

- `bullmq`
- `ioredis`

**核心改造点：**

`packages/crawler/src/spider.ts` 的 `runSpider` 接受一个可选的 `AbortSignal`，让 worker 能从外部停。

**验证：**

1. 起 Postgres + Redis
2. 启动 Worker：`pnpm --filter @hatch-crawler/worker dev`
3. 用脚本手动入队一个 job：

```bash
pnpm --filter @hatch-crawler/worker exec tsx scripts/enqueue-test.ts nextjs-blog
```

4. Worker 控制台看到日志滚动，DB 里 `runs` 表有完整记录，`items` 表有数据

---

## Phase 4 — apps/web (Next.js 看板)

**目标：** Web UI + API 全部完成，能在浏览器里完成 docs/dashboard-spec.md 的所有用户旅程。

**新增文件：**（重点列举）

```
apps/web/
├── package.json
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── components.json          [shadcn 配置]
├── Dockerfile
├── app/
│   ├── layout.tsx           [全局布局：sidebar + topbar]
│   ├── globals.css          [tailwind base]
│   ├── (dashboard)/
│   │   └── dashboard/page.tsx
│   ├── spiders/
│   │   ├── page.tsx
│   │   └── [name]/page.tsx
│   ├── runs/
│   │   ├── page.tsx
│   │   └── [id]/page.tsx
│   ├── items/
│   │   ├── page.tsx
│   │   └── [id]/page.tsx
│   ├── settings/page.tsx
│   ├── api/
│   │   ├── spiders/route.ts
│   │   ├── spiders/[name]/route.ts
│   │   ├── runs/route.ts
│   │   ├── runs/[id]/route.ts
│   │   ├── runs/[id]/stop/route.ts
│   │   ├── runs/[id]/events/route.ts
│   │   ├── items/route.ts
│   │   ├── items/[id]/route.ts
│   │   ├── settings/[key]/route.ts
│   │   └── stats/summary/route.ts
│   └── sse/
│       └── runs/[id]/logs/route.ts
├── components/
│   ├── ui/                  [shadcn 复制下来的组件]
│   ├── nav/sidebar.tsx
│   ├── nav/topbar.tsx
│   ├── runs/run-status-badge.tsx
│   ├── runs/run-row.tsx
│   ├── runs/live-log-stream.tsx
│   ├── runs/new-run-dialog.tsx
│   ├── stats/stats-card.tsx
│   ├── items/json-viewer.tsx
│   └── shared/paginated-table.tsx
├── lib/
│   ├── api-client.ts        [前端调 API 的封装]
│   ├── query-client.ts      [TanStack Query]
│   ├── sse-client.ts        [EventSource 包装]
│   ├── enqueue.ts           [server-side: 把 job 推 BullMQ]
│   └── redis.ts             [pub/sub 客户端]
└── hooks/
    ├── use-runs.ts
    ├── use-run-events.ts    [SSE hook]
    └── use-items.ts
```

**新增依赖：**

- `next` 15+, `react` 19+
- `tailwindcss`, `class-variance-authority`, `clsx`, `tailwind-merge`
- `lucide-react`
- `@tanstack/react-query`
- `react-hook-form`, `@hookform/resolvers`, `zod`
- `sonner`（toast）
- `bullmq`, `ioredis`（server-side enqueue）
- 选用 shadcn 的若干组件：button, dialog, table, dropdown-menu, badge, card, tabs, form, input, select, drawer, scroll-area, separator

**验证：** 跑 `pnpm --filter @hatch-crawler/web dev`，浏览器走完所有页面 + 用户旅程。

---

## Phase 5 — Docker Compose 一键起

**目标：** 在干净机器上 `git clone && docker compose up` 即可访问 `http://localhost:3000` 看到看板。

**新增文件：**

```
docker-compose.yml
.dockerignore
apps/web/Dockerfile
apps/worker/Dockerfile
.env.docker.example
docs/deployment.md           [实际操作步骤 + 排错]
```

**`docker-compose.yml` 形态：**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: hatch
      POSTGRES_USER: hatch
      POSTGRES_PASSWORD: hatch
    volumes:
      - pg_data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - redis_data:/data

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    environment:
      DATABASE_URL: postgres://hatch:hatch@postgres/hatch
      REDIS_URL: redis://redis:6379
    ports:
      - "127.0.0.1:3000:3000"
    depends_on: [postgres, redis]

  worker:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
    environment:
      DATABASE_URL: postgres://hatch:hatch@postgres/hatch
      REDIS_URL: redis://redis:6379
    depends_on: [postgres, redis]

volumes:
  pg_data:
  redis_data:
```

**Dockerfile 策略：**

- 多阶段构建
- 利用 pnpm fetch 缓存
- 只复制对应 app 需要的 packages
- 用 `node:22-alpine` 基镜像

**验证：**

```bash
docker compose up --build
# 等 web 健康检查通过
open http://localhost:3000
```

---

## 阶段间依赖

```
Phase 1 (monorepo) ──► Phase 2 (db) ──► Phase 3 (worker) ──┐
                                              │             │
                                              └──► Phase 4 (web) ──► Phase 5 (compose)
```

Phase 4 同时依赖 db 和 worker 的契约（Storage 接口、事件格式）。
Phase 5 必须等 3 + 4 都跑通才有意义。

## 估算

| Phase | 文件 | 大致工作量                  |
| ----- | ---- | --------------------------- |
| 1     | ~25  | 主要是搬家 + 包装           |
| 2     | ~15  | schema 写完后比较直         |
| 3     | ~10  | 关键是事件桥接 + abort 信号 |
| 4     | ~50+ | 占大头，UI 组件最多         |
| 5     | ~6   | 配置为主                    |

## 验收清单（v1 完成的标志）

- [ ] `docker compose up` 一行起所有服务
- [ ] 浏览器打开 `http://localhost:3000` 看到 Dashboard
- [ ] 点"新建运行"能选 Spider + 调参 + 启动
- [ ] 跳到 Run 详情看实时日志（每秒刷新）
- [ ] Run 完成后能在 Items 页查到结果
- [ ] 配置代理 → 重新运行 → 日志里看到代理生效
- [ ] 设 cron → 每隔时间自动跑
- [ ] 历史 Run 列表分页正常
- [ ] Items 全文搜索能命中 title
- [ ] 类型检查 + ESLint + Prettier 全过
