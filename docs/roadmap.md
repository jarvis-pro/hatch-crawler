# 实施路线

> 把全栈化拆成 4 个 Phase（v1 修订版：合并部署，少一个独立 Worker phase）。
> 一个 Phase 完成了再开下一个。

## Phase 1 — 转 monorepo + 抽离 crawler 包 ✅

**目标：** 现有 CLI 还能跑，但代码结构变成 workspace。

**已完成：**

- `pnpm-workspace.yaml`、`tsconfig.base.json`
- `packages/shared`（CrawlerEvent 等共享类型）
- `packages/crawler`（爬虫引擎库 + Storage 接口 + onEvent + AbortSignal）
- `apps/cli`（v0 兼容入口；**Phase 3 时会被删除**）

> 后续："CLI 不再需要"已经在方案 B 里确认。Phase 3 完成后，
> 引擎自测改用 `packages/crawler/scripts/smoke.ts`（内存 Storage 跑一遍示例 Spider）。

---

## Phase 2 — packages/db (Drizzle + Postgres + pg-boss)

**目标：** 数据层立起来，能本地连 Postgres，跑通 schema 迁移；pg-boss 队列就绪。

**新增文件：**

```
packages/db/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── src/
│   ├── schema.ts            按 docs/data-model.md 定义所有业务表
│   ├── client.ts            drizzle() 工厂（单例）
│   ├── boss.ts              pg-boss 客户端工厂
│   ├── index.ts             re-export
│   └── repositories/
│       ├── runs.ts
│       ├── items.ts
│       ├── events.ts
│       ├── settings.ts
│       └── visited.ts
├── migrations/              drizzle-kit 自动生成
└── scripts/
    ├── migrate.ts           启动时调用 / 也可手动跑
    └── seed.ts              开发期种子数据
```

**新增依赖：**

- `drizzle-orm`
- `drizzle-kit` (dev)
- `postgres`（postgres.js 驱动）
- `pg-boss`

**验证：**

```bash
docker run -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16
DATABASE_URL=postgres://postgres:dev@localhost:5432/postgres pnpm --filter @hatch-crawler/db migrate
DATABASE_URL=... pnpm --filter @hatch-crawler/db seed
psql ... -c "\dt"  # 看到所有业务表
psql ... -c "\dt pgboss.*"  # 看到 pg-boss 队列表
```

---

## Phase 3 — apps/web (Next.js 看板 + API + 内置 Worker)

**目标：** Web UI、API、SSE、内置 pg-boss worker 全部完成。
浏览器里完成 `docs/dashboard-spec.md` 的所有用户旅程。
此阶段同时**删除 `apps/cli`**。

**新增文件：**（重点列举）

```
apps/web/
├── package.json
├── tsconfig.json
├── next.config.mjs
├── tailwind.config.ts
├── postcss.config.mjs
├── components.json          shadcn 配置
├── instrumentation.ts       Next.js 钩子：进程启动时拉起 pg-boss worker
├── app/
│   ├── layout.tsx           全局布局：sidebar + topbar
│   ├── globals.css          tailwind base
│   ├── (dashboard)/dashboard/page.tsx
│   ├── spiders/page.tsx     和 [name]/page.tsx
│   ├── runs/page.tsx        和 [id]/page.tsx
│   ├── items/page.tsx       和 [id]/page.tsx
│   ├── settings/page.tsx
│   ├── api/
│   │   ├── spiders/         GET/PUT
│   │   ├── runs/            POST/GET, [id]/{GET, stop, events}
│   │   ├── items/           GET, [id]/GET
│   │   ├── settings/[key]/  GET/PUT
│   │   └── stats/summary/   GET
│   └── sse/runs/[id]/logs/route.ts
├── components/
│   ├── ui/                  shadcn 复制下来的组件
│   ├── nav/                 sidebar / topbar
│   ├── runs/                badge / row / live-log-stream / new-run-dialog
│   ├── stats/stats-card.tsx
│   ├── items/json-viewer.tsx
│   └── shared/paginated-table.tsx
├── lib/
│   ├── api-client.ts        前端调 API 的封装
│   ├── query-client.ts      TanStack Query
│   ├── sse-client.ts        EventSource 包装
│   ├── worker/
│   │   ├── index.ts         pg-boss worker 启动 / 优雅关停 / 单例守卫
│   │   ├── job-handler.ts   一个 job 的执行逻辑
│   │   ├── postgres-storage.ts  实现 Storage 接口
│   │   ├── event-bus.ts     进程内 EventBus（SSE 用）
│   │   └── stale-cleanup.ts 启动时清理 stale running runs
│   └── spider-registry.ts   name → Spider 类
└── hooks/
    ├── use-runs.ts
    ├── use-run-events.ts
    └── use-items.ts
```

**新增依赖：**

- `next` 15+, `react` 19+
- `tailwindcss`, `class-variance-authority`, `clsx`, `tailwind-merge`
- `lucide-react`
- `@tanstack/react-query`
- `react-hook-form`, `@hookform/resolvers`, `zod`
- `sonner`（toast）
- shadcn 的若干组件

**同时删除：**

- `apps/cli/`（已在方案 B 中确认不再需要）
- `packages/crawler/scripts/smoke.ts`（如果之前临时加过；保留也行）

**验证：**

```bash
docker compose up postgres -d
DATABASE_URL=... pnpm --filter @hatch-crawler/web dev
# 浏览器打开 http://localhost:3000 走完 docs/dashboard-spec.md 所有页面
```

---

## Phase 4 — Docker Compose 一键起

**目标：** 干净机器上 `git clone && docker compose up` 能跑。

**新增文件：**

```
docker-compose.yml
.dockerignore
apps/web/Dockerfile
.env.docker.example
docs/deployment.md
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
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U hatch"]
      interval: 5s
      timeout: 3s
      retries: 5

  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    environment:
      DATABASE_URL: postgres://hatch:hatch@postgres/hatch
      NODE_ENV: production
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  pg_data:
```

只有 **2 个服务**。

**Dockerfile 策略：**

- 多阶段构建（deps / builder / runner）
- 利用 pnpm fetch 缓存
- 只复制对应 app 需要的 packages
- `node:22-alpine` 基镜像

**验证：**

```bash
docker compose up --build
open http://localhost:3000
```

---

## 阶段间依赖

```
Phase 1 (monorepo) ──► Phase 2 (db) ──► Phase 3 (web) ──► Phase 4 (compose)
                  ✅
```

线性、串行。

## 估算

| Phase | 文件 | 大致工作量                          |
| ----- | ---- | ----------------------------------- |
| 1 ✅  | ~25  | 已完成                              |
| 2     | ~14  | schema 写完后比较直                 |
| 3     | ~50+ | 占大头：API + 看板 UI + 内置 Worker |
| 4     | ~5   | 配置为主                            |

## 验收清单（v1 完成的标志）

- [ ] `docker compose up` 一行起所有服务
- [ ] 浏览器打开 `http://localhost:3000` 看到 Dashboard
- [ ] 点"新建运行"能选 Spider + 调参 + 启动
- [ ] 跳到 Run 详情看实时日志（每秒刷新）
- [ ] Run 完成后能在 Items 页查到结果
- [ ] 配置代理 → 重新运行 → 日志里看到代理生效
- [ ] 设 cron → 每隔时间自动跑（pg-boss schedule）
- [ ] 历史 Run 列表分页正常
- [ ] Items 全文搜索能命中 title
- [ ] 类型检查 + ESLint + Prettier 全过
- [ ] Web 重启后，正在跑的 run 被正确标记为 failed（stale-run cleanup）
