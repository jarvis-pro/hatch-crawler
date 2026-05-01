# hatch-crawler

一个用 Node.js + TypeScript 写的、面向 **Next.js 站点**优化的全功能爬虫。
单仓 Next.js 全栈应用，浏览器看板 + API + SSE + 进程内 pg-boss worker 一体化部署。

## 为什么针对 Next.js？

绝大多数 Next.js 页面会在 HTML 中内嵌 `<script id="__NEXT_DATA__">`，
里面就是页面真正的结构化数据 (`pageProps`)。还有：

- SSG/ISR 页面提供 `_next/data/{buildId}/{path}.json` JSON 接口
- 直接命中 JSON 比 DOM 解析稳得多，也更快

`src/lib/crawler/parsers/next-data-parser.ts` 就是围绕这两点做的。

## 项目结构（单仓 Next.js 应用）

```
hatch-crawler/
├── docs/                          设计与运维文档（按读者目的分类）
│   ├── README.md                  顶层导航
│   ├── getting-started/           入门：架构总览 + 实施路线
│   │   ├── architecture.md
│   │   └── roadmap.md
│   ├── reference/                 契约：schema / API / 看板线框
│   │   ├── data-model.md
│   │   ├── api-spec.md
│   │   └── dashboard-spec.md
│   ├── deploy/                    部署形态
│   │   └── deployment.md
│   └── rfcs/                      重大架构决策提案
│       └── 0001-multi-platform.md
├── scripts/                       开发期脚本
│   ├── db-migrate.ts              手动跑迁移（生产时由 instrumentation 自动跑）
│   ├── db-seed.ts                 灌入示例 Spider + 默认 settings
│   └── smoke.ts                   引擎烟雾测试（内存 Storage，不依赖 DB）
├── src/
│   ├── app/                       Next.js App Router
│   │   ├── (页面) dashboard / spiders / runs / items / settings
│   │   ├── api/                   REST 端点（spiders / runs / items / settings / stats）
│   │   ├── sse/runs/[id]/logs/    实时日志 SSE
│   │   ├── layout.tsx / providers.tsx / page.tsx / globals.css
│   ├── components/
│   │   ├── ui/                    shadcn 复制下来的基础组件
│   │   ├── nav/                   sidebar / topbar
│   │   ├── runs/                  run-status-badge / new-run-dialog / live-log-stream
│   │   ├── items/json-viewer.tsx
│   │   └── stats/stats-card.tsx
│   ├── lib/
│   │   ├── crawler/               爬虫核心引擎（core / middleware / parsers / spiders / storage / utils）
│   │   ├── db/                    Prisma + Postgres + pg-boss（client / boss / migrate / repositories）
│   │   ├── worker/                进程内 pg-boss worker（job-handler / postgres-storage / event-bus）
│   │   ├── shared/                跨模块共享类型（CrawlerEvent 等）
│   │   ├── api/response.ts        统一响应包装
│   │   ├── api-client.ts          前端调 API 封装
│   │   ├── query-client.ts        TanStack Query 配置
│   │   ├── spider-registry.ts     name → Spider 实例
│   │   ├── env.ts                 环境变量校验
│   │   └── utils.ts
│   └── instrumentation.ts         Next.js 进程启动钩子：跑迁移 + 启动 worker
├── prisma/schema.prisma           Prisma 权威 schema
├── next.config.mjs / tailwind.config.ts / postcss.config.mjs
├── Dockerfile                     单阶段多步构建 web 镜像
├── docker-compose.yml             postgres + web 两个服务
├── eslint.config.js / .prettierrc.json / commitlint.config.js / .husky/
└── package.json                   单 package（不再是 monorepo）
```

> 早期的 CLI 形态、以及早期方案里 `packages/*` + `apps/web` 的 monorepo 结构都已合并为
> 单一 Next.js 项目；引擎自测仍可通过 `pnpm smoke` 在内存 Storage 下跑示例 Spider。

## 快速开始

> 环境要求：**Node.js 22+**（已通过 `.nvmrc` 与 `engines.node` 锁定，
> 用 nvm/fnm/volta 进入项目目录会自动切到 Node 22）。
>
> 本项目使用 **pnpm** 管理依赖（`packageManager` 字段已锁定版本）。
> 没装 pnpm 的话：`npm i -g pnpm` 或参考 [pnpm.io/installation](https://pnpm.io/installation)。

### 一键起完整看板（推荐，Docker Compose）

```bash
cp .env.example .env   # 已经有 .env 就跳过
docker compose up --build
# 等到 hatch-web 日志出现 "[instrumentation] migrations done"
open http://localhost:3000
```

### 仅本地 dev（看板）

```bash
# 1. 安装依赖（同时初始化 husky）
pnpm install

# 2. 起 Postgres
docker compose up postgres -d

# 3. 启动 Next.js 看板（含内置 worker、自动迁移）
DATABASE_URL=postgres://hatch:hatch@localhost:5432/hatch pnpm dev
```

> **媒体下载/转码**（RFC 0002）需要本机装 `ffmpeg` 与 `yt-dlp`。
> macOS：`brew install ffmpeg yt-dlp`；
> Docker 镜像已内置，无需额外安装。
> 启动后看板「设置 → 下载」会显示这两者的健康度；缺失时也能继续做元数据抓取，但下载/转码相关入口会禁用。

### 不要看板，只调引擎

```bash
pnpm smoke    # 内存 Storage 跑一遍示例 Spider
pnpm check    # typecheck + lint + format:check
```

## 命令一览

| 命令                                | 作用                                           |
| ----------------------------------- | ---------------------------------------------- |
| `pnpm dev`                          | 启动 Next.js 看板（开发模式，HMR + Turbopack） |
| `pnpm build`                        | 生产构建（Next.js standalone）                 |
| `pnpm start`                        | 启动 Next.js 生产模式（先 `pnpm build`）       |
| `pnpm db:migrate`                   | 手动跑迁移（web 启动时也会自动跑）             |
| `pnpm db:seed`                      | 灌入示例 Spider + 默认 settings                |
| `pnpm db:generate`                  | `prisma generate` 刷新生成的 client 类型       |
| `pnpm db:studio`                    | `prisma studio` 浏览数据                       |
| `pnpm smoke`                        | 引擎烟雾测试（内存 Storage，不依赖 DB）        |
| `pnpm typecheck`                    | 全量类型检查                                   |
| `pnpm lint` / `pnpm lint:fix`       | ESLint                                         |
| `pnpm format` / `pnpm format:check` | Prettier                                       |
| `pnpm check`                        | 三连：typecheck + lint + format:check          |

## 工程化基建

| 工具            | 配置文件                              | 说明                                      |
| --------------- | ------------------------------------- | ----------------------------------------- |
| Prettier        | `.prettierrc.json`, `.prettierignore` | 统一格式                                  |
| ESLint 9 (flat) | `eslint.config.js`                    | TS 静态检查，已关闭与 Prettier 冲突的规则 |
| EditorConfig    | `.editorconfig`                       | 跨编辑器风格一致                          |
| Husky           | `.husky/`                             | git 钩子托管                              |
| lint-staged     | `package.json` `lint-staged` 字段     | 提交前只对暂存文件跑 prettier             |
| commitlint      | `commitlint.config.js`                | Conventional Commits（支持中文 subject）  |

提交时会自动触发：

1. `pre-commit`: 对暂存的 `.ts/.tsx/.js/.json/.md/.css/.yml/.yaml` 跑 `prettier --write`
2. `commit-msg`: 校验 commit message 是否符合 `<type>: <描述>`

> 注：`better-sqlite3` 是原生模块，pnpm 10 默认不跑 postinstall 脚本。
> 已经在根 `package.json` 的 `pnpm.onlyBuiltDependencies` 里把它白名单出来，
> 所以 `pnpm install` 会自动编译。当前生产路径走 Postgres，SQLite 仅给
> `src/lib/crawler/storage/sqlite-storage.ts` 留出"脱机调试"的备用实现。

## 写一个新的 Spider

新建 `src/lib/crawler/spiders/my-spider.ts`：

```ts
import { BaseSpider, type SpiderContext } from '../core/spider';
import { extractNextData } from '../parsers/next-data-parser';

export class MySpider extends BaseSpider {
  override readonly name = 'my-site';
  override readonly maxDepth = 3;
  override readonly startUrls = [{ url: 'https://example.com', type: 'index' }];

  override async parse(ctx: SpiderContext): Promise<void> {
    const data = extractNextData(ctx.response.body);

    ctx.emit({
      url: ctx.url,
      type: ctx.type,
      payload: { props: data?.props?.pageProps },
    });

    ctx.enqueue({ url: 'https://example.com/other', type: 'detail' });
  }
}
```

注册 Spider：在 `src/lib/spider-registry.ts` 把新类映射到 `name`，并把对应的
default 配置写进 `scripts/db-seed.ts`（或直接在看板 `/spiders` 页面手工创建）。
然后：

- `pnpm smoke`：纯引擎烟雾测试（替换 `scripts/smoke.ts` 里使用的 Spider）
- 看板 → `/spiders` → "立即运行"：完整链路验证

## 反反爬开关（按需）

`.env` 中：

```ini
# 多个代理逗号分隔。留空则直连。
PROXY_LIST=http://user:pass@proxy1:8080,http://user:pass@proxy2:8080

# 单一域名两次请求最小间隔
PER_HOST_INTERVAL_MS=500

# 全局并发
CONCURRENCY=4
```

UA 池在 `src/lib/crawler/middleware/ua-pool.ts` 里维护，按需追加；运行时也可以通过
看板 `/settings` 的 "User-Agent 池" Tab 覆盖。

## 增量爬取

- `visited` 表按 `(spider, url_hash)` 记录已访问，重启后自动跳过
- `items` 表按 `(spider, url_hash, content_hash)` 唯一约束，
  内容没变就不会重复入库 —— 适合"只在内容变化时通知"的场景

所有数据都落 Postgres；smoke 测试用内存 Storage（`src/lib/crawler/storage/`）。

## 调度

每个 Spider 可以在看板 `/spiders/[name]` 单独配 cron（pg-boss schedule 实现，
进程内 worker 直接消费）。

## 全栈版本

完整看板的实现路线在 `docs/getting-started/roadmap.md` 中描述：

1. **Phase 1** — 抽离引擎模块、确立 `src/lib/crawler` 边界 ✅
2. **Phase 2** — `src/lib/db`（Prisma + Postgres + pg-boss）✅
3. **Phase 3** — `src/app` 看板 + API + SSE + `src/lib/worker` ✅
4. **Phase 4** — Docker Compose 一键起 ✅

每个 Phase 完成都能独立验证；Phase 1-4 已全部交付。

## 后续扩展方向

- **JS 渲染兜底**：对没有 `__NEXT_DATA__` 的 SPA 站点，集成 Playwright 作为 Fetcher 的另一个实现
- **结构化 schema**：在 `emit` 时用 Zod 校验 payload
- **监控**：对接 OpenTelemetry / Prometheus
- **认证**：NextAuth + Postgres adapter（下一阶段）
