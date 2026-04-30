# hatch-crawler

一个用 Node.js + TypeScript 写的、面向 **Next.js 站点**优化的全功能爬虫脚手架。
为学习目的设计，但架构按生产级思路组织，方便后续扩展。

## 为什么针对 Next.js？

绝大多数 Next.js 页面会在 HTML 中内嵌 `<script id="__NEXT_DATA__">`，
里面就是页面真正的结构化数据 (`pageProps`)。还有：

- SSG/ISR 页面提供 `_next/data/{buildId}/{path}.json` JSON 接口
- 直接命中 JSON 比 DOM 解析稳得多，也更快

`src/parsers/next-data-parser.ts` 就是围绕这两点做的。

## 项目结构

```
src/
├── config/         环境变量与运行时配置
├── core/
│   ├── fetcher.ts  HTTP 客户端 (got + 重试 + 限流 + 代理)
│   ├── queue.ts    URL 前沿队列 + 指纹去重
│   ├── spider.ts   引擎：并发、enqueue/emit、统计
│   └── scheduler.ts node-cron 调度
├── middleware/
│   ├── proxy-pool.ts   代理池 + 失败计数
│   ├── ua-pool.ts      User-Agent 轮换
│   └── rate-limiter.ts 按域名限流
├── parsers/
│   ├── next-data-parser.ts  __NEXT_DATA__ 抽取
│   └── html-parser.ts       Cheerio 兜底
├── storage/
│   ├── sqlite-storage.ts    SQLite 结构化存储 + 增量去重
│   └── file-storage.ts      JSONL 追加写
├── spiders/
│   └── nextjs-blog-spider.ts  示例 Spider
└── index.ts        入口
```

## 快速开始

> 环境要求：**Node.js 22+**（已通过 `.nvmrc` 与 `engines.node` 锁定，
> 用 nvm/fnm/volta 的话进入项目目录会自动切到 Node 22）。
>
> 本项目使用 **pnpm** 管理依赖（`packageManager` 字段已锁定版本）。
> 没装 pnpm 的话：`npm i -g pnpm` 或参考 [pnpm.io/installation](https://pnpm.io/installation)。

```bash
# 1. 安装（同时会通过 prepare 脚本自动初始化 husky）
pnpm install

# 2. 配置（可直接用默认值）
cp .env.example .env

# 3. 运行（一次性）
pnpm crawl

# 4. 一键体检：typecheck + lint + format
pnpm check

# 5. 编译产物
pnpm build
```

## 工程化基建

| 工具            | 配置文件                              | 说明                                          |
| --------------- | ------------------------------------- | --------------------------------------------- |
| Prettier        | `.prettierrc.json`, `.prettierignore` | 统一格式                                      |
| ESLint 9 (flat) | `eslint.config.js`                    | TS 静态检查，已关闭与 Prettier 冲突的规则     |
| EditorConfig    | `.editorconfig`                       | 跨编辑器风格一致                              |
| Husky           | `.husky/`                             | git 钩子托管                                  |
| lint-staged     | `package.json` `lint-staged` 字段     | 提交前只对暂存文件跑 lint + format            |
| commitlint      | `commitlint.config.js`                | 校验 Conventional Commits（支持中文 subject） |

常用命令：

```bash
pnpm lint           # 全量 lint
pnpm lint:fix       # 自动修复
pnpm format         # 全量格式化
pnpm format:check   # 仅检查
pnpm typecheck      # tsc --noEmit
pnpm check          # 三连：typecheck + lint + format:check
```

提交时会自动触发：

1. `pre-commit`: 对暂存的 `.ts/.js/.json/.md` 跑 `eslint --fix` + `prettier --write`
2. `commit-msg`: 校验提交信息是否符合 `<type>: <描述>`，type 取自 `feat / fix / refactor / perf / style / test / docs / build / ci / chore / revert`

> 注：`better-sqlite3` 是原生模块，pnpm 10 默认不跑 postinstall 脚本。
> 已经在 `package.json` 的 `pnpm.onlyBuiltDependencies` 里把它白名单出来，
> 所以 `pnpm install` 会自动编译。如果首次安装报错 (`Ignored build scripts`)，
> 跑一次 `pnpm approve-builds` 即可。

爬取结果默认写入：

- `data/crawler.sqlite` —— 结构化表（`items`、`visited`）
- `data/items.jsonl` —— 追加式 JSON Lines

## 写一个新的 Spider

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

    // 派发更多 URL
    ctx.enqueue({ url: "https://example.com/other", type: "detail" });
  }
}
```

然后在 `src/index.ts` 里把它换进去即可。

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

UA 池在 `src/middleware/ua-pool.ts` 里维护，按需追加。

## 增量爬取

- `visited` 表按 URL 指纹记录已访问，重启后自动跳过
- `items` 表按 `(spider, url_hash, content_hash)` 唯一约束，
  内容没变就不会重复入库 —— 适合"只在内容变化时通知"的场景

## 调度

`.env` 里设置 `CRON_SCHEDULE=*/30 * * * *` 即可每 30 分钟触发一次。
没设置就跑一次然后退出。

## 后续扩展方向

- **真正的分布式**：把 `UrlQueue` 替换为 BullMQ + Redis，
  多个 worker 进程消费同一个队列。接口已经留好了。
- **JS 渲染兜底**：对没有 `__NEXT_DATA__` 的 SPA 站点，
  集成 Playwright 作为 Fetcher 的另一个实现。
- **结构化 schema**：引入 `zod` 在 `emit` 时校验 payload。
- **监控**：对接 OpenTelemetry / Prometheus。
