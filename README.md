# hatch-crawler

一个用 Node.js + TypeScript 写的、面向 **Next.js 站点**优化的全功能爬虫。
v1 起从 CLI 工具升级为带 Web 看板的全栈应用，按 pnpm workspace 组织。

## 为什么针对 Next.js？

绝大多数 Next.js 页面会在 HTML 中内嵌 `<script id="__NEXT_DATA__">`，
里面就是页面真正的结构化数据 (`pageProps`)。还有：

- SSG/ISR 页面提供 `_next/data/{buildId}/{path}.json` JSON 接口
- 直接命中 JSON 比 DOM 解析稳得多，也更快

`packages/crawler/src/parsers/next-data-parser.ts` 就是围绕这两点做的。

## 项目结构（monorepo）

```
hatch-crawler/
├── docs/                      v1 设计文档（先读）
│   ├── architecture.md        架构总览、服务拓扑
│   ├── data-model.md          Postgres schema
│   ├── api-spec.md            REST + SSE 契约
│   ├── dashboard-spec.md      看板页面线框
│   └── roadmap.md             4 阶段实施路线
├── packages/
│   ├── crawler/               爬虫核心引擎库（Storage / Spider / Fetcher）
│   │   └── src/
│   │       ├── core/          fetcher / queue / spider / scheduler
│   │       ├── middleware/    proxy-pool / ua-pool / rate-limiter
│   │       ├── parsers/       next-data / html
│   │       ├── storage/       Storage 接口 + SqliteStorage
│   │       ├── spiders/       内置示例 Spider
│   │       └── utils/         logger / url 工具
│   ├── shared/                跨模块共享类型（CrawlerEvent 等）
│   └── db/                    [Phase 2] Drizzle + Postgres + pg-boss
└── apps/
    └── web/                   [Phase 3] Next.js 看板 + API + 内置 Worker
```

> v0 的 `apps/cli` 在 v1 演进过程中会被删除。在 Phase 3 完成前，
> 引擎自测用 `pnpm --filter @hatch-crawler/crawler smoke`（内存 Storage 跑一次示例 Spider）。

## 快速开始

> 环境要求：**Node.js 22+**（已通过 `.nvmrc` 与 `engines.node` 锁定，
> 用 nvm/fnm/volta 进入项目目录会自动切到 Node 22）。
>
> 本项目使用 **pnpm** 管理依赖（`packageManager` 字段已锁定版本）。
> 没装 pnpm 的话：`npm i -g pnpm` 或参考 [pnpm.io/installation](https://pnpm.io/installation)。

### 一键起完整看板（推荐，Docker Compose）

```bash
cp .env.docker.example .env
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

### 不要看板，只调引擎

```bash
pnpm smoke    # 内存 Storage 跑一遍示例 Spider
pnpm check    # typecheck + lint + format
```

## 命令一览

| 命令                                | 作用                                     |
| ----------------------------------- | ---------------------------------------- |
| `pnpm dev`                          | 启动 Next.js 看板（开发模式，HMR）       |
| `pnpm start`                        | 启动 Next.js 生产模式（先 `pnpm build`） |
| `pnpm build`                        | 编译所有 workspace 包                    |
| `pnpm db:migrate`                   | 手动跑迁移（web 启动时也会自动跑）       |
| `pnpm db:seed`                      | 灌入示例 Spider + 默认 settings          |
| `pnpm smoke`                        | 引擎烟雾测试（内存 Storage，不依赖 DB）  |
| `pnpm typecheck`                    | 全量类型检查                             |
| `pnpm lint` / `pnpm lint:fix`       | ESLint                                   |
| `pnpm format` / `pnpm format:check` | Prettier                                 |
| `pnpm check`                        | 三连：typecheck + lint + format:check    |
| `pnpm clean`                        | 清空所有 dist/                           |

针对单个子包：

```bash
pnpm --filter @hatch-crawler/crawler typecheck
pnpm --filter @hatch-crawler/crawler smoke
```

## 工程化基建

| 工具            | 配置文件                              | 说明                                      |
| --------------- | ------------------------------------- | ----------------------------------------- |
| Prettier        | `.prettierrc.json`, `.prettierignore` | 统一格式                                  |
| ESLint 9 (flat) | `eslint.config.js`                    | TS 静态检查，已关闭与 Prettier 冲突的规则 |
| EditorConfig    | `.editorconfig`                       | 跨编辑器风格一致                          |
| Husky           | `.husky/`                             | git 钩子托管                              |
| lint-staged     | `package.json` `lint-staged` 字段     | 提交前只对暂存文件跑 lint + format        |
| commitlint      | `commitlint.config.js`                | Conventional Commits（支持中文 subject）  |

提交时会自动触发：

1. `pre-commit`: 对暂存的 `.ts/.js/.json/.md` 跑 `eslint --fix` + `prettier --write`
2. `commit-msg`: 校验 commit message 是否符合 `<type>: <描述>`

> 注：`better-sqlite3` 是原生模块，pnpm 10 默认不跑 postinstall 脚本。
> 已经在根 `package.json` 的 `pnpm.onlyBuiltDependencies` 里把它白名单出来，
> 所以 `pnpm install` 会自动编译。

## 写一个新的 Spider

新建 `packages/crawler/src/spiders/my-spider.ts`：

```ts
import { BaseSpider, type SpiderContext } from "../core/spider.js";
import { extractNextData } from "../parsers/next-data-parser.js";

export class MySpider extends BaseSpider {
  override readonly name = "my-site";
  override readonly maxDepth = 3;
  override readonly startUrls = [{ url: "https://example.com", type: "index" }];

  override async parse(ctx: SpiderContext): Promise<void> {
    const data = extractNextData(ctx.response.body);

    ctx.emit({
      url: ctx.url,
      type: ctx.type,
      payload: { props: data?.props?.pageProps },
    });

    ctx.enqueue({ url: "https://example.com/other", type: "detail" });
  }
}
```

然后在 `packages/crawler/scripts/smoke.ts` 把 `NextJsBlogSpider` 换成你的 Spider 跑烟雾测试。
Phase 3 加上看板后，可以直接在 UI 里选择/配置 Spider，不需要改代码。

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

UA 池在 `packages/crawler/src/middleware/ua-pool.ts` 里维护，按需追加。

## 增量爬取

- `visited` 表按 `(spider, url_hash)` 记录已访问，重启后自动跳过
- `items` 表按 `(spider, url_hash, content_hash)` 唯一约束，
  内容没变就不会重复入库 —— 适合"只在内容变化时通知"的场景

Phase 3 起统一落 Postgres；smoke 测试用内存 Storage。

## 调度

Phase 3 起，看板上每个 Spider 可以单独配 cron（pg-boss schedule 实现）。

## 全栈版本

完整看板实现在 `docs/roadmap.md` 里分 4 阶段推进：

1. **Phase 1** — pnpm workspace + 抽离 crawler 包 ✅
2. **Phase 2** — `packages/db`（Drizzle + Postgres + pg-boss）
3. **Phase 3** — `apps/web`（Next.js 看板 + API + SSE + 内置 Worker）
4. **Phase 4** — Docker Compose 一键起

每个 Phase 完成都能独立验证。

## 后续扩展方向

- **JS 渲染兜底**：对没有 `__NEXT_DATA__` 的 SPA 站点，集成 Playwright 作为 Fetcher 的另一个实现
- **结构化 schema**：在 `emit` 时用 Zod 校验 payload
- **监控**：对接 OpenTelemetry / Prometheus
- **认证**：NextAuth + Postgres adapter（v2）
