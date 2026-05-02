# hatch-crawler

一个用 Node.js + TypeScript 写的多平台内容爬虫，附带浏览器看板。
单仓 Next.js 全栈应用：浏览器看板 + REST API + SSE 实时日志 + 进程内 pg-boss worker，跑在同一进程里。

## 能干什么

- **5 个内容平台元数据抓取**：YouTube / Bilibili / 小红书 / 微博 / 抖音；每平台 2-4 个内置 Spider（搜索 / 用户视频 / 视频详情 / 笔记评论等），共 14 个
- **按链接抓**：粘贴 URL 列表（1..50 条）→ 后端按 host 路由到对应 extractor → 输出统一 `VideoItem` 结构
- **多资源类型**：article / video / audio / image / post 五种 kind，每种有独立 Zod schema 和差异化 UI
- **凭据管理**：accounts 表 AES-256-GCM 加密存 cookie / API Key；自动注入 spider；失败计数到阈值自动 ban + 看板可解禁
- **实时调度**：每个 Spider 单独配 cron（pg-boss schedule）
- **视频按需流式下载**：item 详情页"下载"菜单 → 后端 spawn `yt-dlp` 或 `got` stream → 浏览器原生下载（无离线媒体仓库）
- **看板**：浏览器里完成新建 / 启停 / 监控 / 浏览结果 / 配代理 / 接 Webhook 通知 / 看 ffmpeg & yt-dlp 健康度
- **类型一致**：API 入参 Zod 校验，jsonb 列在 db/index.ts 收紧成业务类型

## 项目结构

```
hatch-crawler/
├── docs/                          设计与运维文档（getting-started / reference / deploy / rfcs）
├── scripts/                       开发期脚本
│   ├── db-migrate.ts              手动跑迁移（生产时由 instrumentation 自动跑）
│   ├── db-seed.ts                 灌入默认 settings
│   ├── smoke.ts                   引擎烟雾测试（内存 Storage，不依赖 DB）
│   └── smoke-download.ts          下载链路烟雾测试
├── src/
│   ├── app/                       Next.js App Router
│   │   ├── (页面) dashboard / spiders / runs / items / settings
│   │   ├── api/                   REST：spiders / runs / items / extract / accounts /
│   │   │                           settings / stats / system / spiders/registry
│   │   └── sse/runs/[id]/logs/    实时日志 SSE
│   ├── components/                shadcn ui + nav / runs / items / stats
│   ├── lib/
│   │   ├── crawler/               爬虫核心引擎
│   │   │   ├── core/ middleware/ parsers/ utils/ config/
│   │   │   ├── kinds/             资源类型 Zod schema（article / video / audio / image / post）
│   │   │   ├── platforms/         5 个平台子目录
│   │   │   ├── extractors/        URL 驱动的单页 extractor（types / registry / youtube）
│   │   │   ├── spiders/           跨平台 spider（url-extractor）
│   │   │   ├── fetcher/           平台 API 客户端封装
│   │   │   └── storage/           Storage 接口 + 内存 / file / SQLite 实现
│   │   ├── db/                    Prisma + pg-boss + 业务 repository
│   │   ├── worker/                进程内 pg-boss worker
│   │   ├── downloads/             yt-dlp / http / system-deps
│   │   ├── shared/                CrawlerEvent 等共享类型
│   │   ├── api/response.ts        统一响应包装
│   │   ├── spider-registry.ts     注册表：name → { factory, platform, excludeFromAutoDisable }
│   │   ├── env.ts                 环境变量懒校验
│   │   └── api-client.ts / query-client.ts / utils.ts
│   └── instrumentation.ts         启动钩子：runMigrations + ensureBuiltinSpiders + startWorker
├── prisma/schema.prisma           Prisma 权威 schema（与 src/lib/db/migrate.ts 同步）
├── Dockerfile                     多阶段构建（runner 内置 ffmpeg + yt-dlp）
├── docker-compose.yml             postgres + web 两个服务
└── package.json                   单 package（不再是 monorepo）
```

## 技术栈

| 维度      | 选型                                                           |
| --------- | -------------------------------------------------------------- |
| 运行时    | Node.js 22+（`.nvmrc` / `engines.node` 锁定）                  |
| 包管理    | pnpm 10（`packageManager` 锁定，禁用 npm/yarn）                |
| 框架      | Next.js 15 App Router + React 19 + Turbopack（dev）            |
| 类型      | TypeScript 5 strict + `noUncheckedIndexedAccess`               |
| 数据库    | PostgreSQL 16（业务表 + `pgboss` schema 共库）                 |
| ORM       | Prisma 5                                                       |
| 队列+调度 | pg-boss 10                                                     |
| UI        | Tailwind 3 + shadcn/ui（已复制进 `src/components/ui/`）+ Radix |
| 状态      | TanStack Query 5                                               |
| 校验      | Zod 3                                                          |
| 日志      | Pino + pino-pretty                                             |

## 快速开始

> Node.js 22+，pnpm 10。
> Docker 镜像内置 `ffmpeg + yt-dlp`；本地 dev 用 `brew install ffmpeg yt-dlp` 或 `apt install ffmpeg && pip install yt-dlp`。

### 一键起完整看板（推荐，Docker Compose）

```bash
cp .env.example .env   # 已经有 .env 就跳过
docker compose up --build
# 等到 hatch-web 日志出现 "[instrumentation] migrations done"
open http://localhost:3000
```

### 仅本地 dev

```bash
pnpm install                    # 同时初始化 husky
docker compose up postgres -d   # 只起 Postgres
DATABASE_URL=postgres://hatch:hatch@localhost:5432/hatch pnpm dev
```

启动后看板「设置 → 下载」会显示 ffmpeg / yt-dlp 健康度，缺失时元数据抓取仍可用，下载/转码相关入口禁用。

### 不要看板，只调引擎

```bash
pnpm smoke    # 内存 Storage 跑一遍示例 Spider
pnpm check    # typecheck + lint + format:check
```

## 命令一览

| 命令                                 | 作用                                                |
| ------------------------------------ | --------------------------------------------------- |
| `pnpm dev`                           | Next.js dev（HMR + Turbopack；含 worker、自动迁移） |
| `pnpm build` / `pnpm start`          | 生产构建 / 启动                                     |
| `pnpm db:migrate`                    | 手动跑迁移（web 启动时也会自动跑）                  |
| `pnpm db:seed`                       | 灌入默认 settings                                   |
| `pnpm db:generate`                   | `prisma generate` 刷新 client 类型                  |
| `pnpm db:studio`                     | `prisma studio`                                     |
| `pnpm smoke`                         | 引擎烟雾测试（不依赖 DB）                           |
| `pnpm typecheck` / `lint` / `format` | 静态检查                                            |
| `pnpm check`                         | 三连：typecheck + lint + format:check               |

## 关键环境变量

| 变量                  | 说明                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------- |
| `DATABASE_URL`        | Postgres 连接串（必填）                                                               |
| `LOG_LEVEL`           | pino 级别，默认 `info`                                                                |
| `ACCOUNTS_MASTER_KEY` | accounts 表 AES-256-GCM 主密钥，hex 64 字符。**生产必须设置**；dev 不设 fallback 全零 |

完整列表见 `.env.example` 与 `docs/deploy/deployment.md`。

## 写一个新 Spider

### 平台 Spider

新建 `src/lib/crawler/platforms/<p>/spiders/my-spider.ts` 继承 `BaseSpider` 并实现 `parse(ctx)`：

```ts
import { BaseSpider, type SpiderContext } from '../../../core/spider';

export class MySpider extends BaseSpider {
  override readonly name = 'my-platform-thing';
  override readonly maxDepth = 3;
  override readonly startUrls = [{ url: 'https://example.com', type: 'index' }];

  override async parse(ctx: SpiderContext): Promise<void> {
    ctx.emit({
      url: ctx.url,
      type: 'video',
      platform: 'my-platform',
      kind: 'video',
      sourceId: '<...>',
      payload: {
        /* 符合 kinds/video.ts 的 VideoItem schema */
      },
    });
    ctx.enqueue({ url: 'https://example.com/page2', type: 'list' });
  }
}
```

注册：在 `src/lib/spider-registry.ts` 添加

```ts
'my-platform-thing': {
  factory: (params) => new MySpider(params),
  platform: 'my-platform',
},
```

然后在看板 `/spiders` 创建一行 spider（type 选刚加的注册键，name 写中文别名）。验证：

- `pnpm smoke`：纯引擎
- 看板「立即运行」：完整链路

### URL 驱动的 Extractor（推荐）

如果只想"按用户粘贴的 URL 抽取单页元数据"，写一个 Extractor 比写 Spider 更轻：

1. 在 `src/lib/crawler/extractors/<platform>/index.ts` 实现 `Extractor` 接口（`urlPatterns` / `match` / `canonicalize` / `extractId` / `extract`）
2. 在 `extractors/registry.ts` 的 `extractorRegistry` 数组里 push 一行
3. 立即可用：`POST /api/extract { urls: [...] }` 自动按 host 路由

`url-extractor` spider 是它们的执行壳，`excludeFromAutoDisable` 让用户粘失效链接不会让整个功能被关掉。

## 增量与去重

- 业务侧两层去重：
  - `(platform, source_id)` 部分唯一索引：跨 spider/run 同一来源仅一行
  - `(spider, url_hash, content_hash)` 唯一索引：兜底，相同 url + 相同内容不重复
- spider `consecutive_failures` 超阈值（默认 3）自动停用 + Webhook 告警；账号失败计数到阈值（默认 5）自动 ban

## 调度

每个 Spider 可在 `/spiders/[id]` 配 cron 表达式（pg-boss schedule 实现），进程内 worker 直接消费。

## 工程化基建

| 工具          | 配置                                  | 说明                                     |
| ------------- | ------------------------------------- | ---------------------------------------- |
| Prettier      | `.prettierrc.json`, `.prettierignore` | 统一格式                                 |
| ESLint 9 flat | `eslint.config.js`                    | TS 静态检查                              |
| Husky         | `.husky/`                             | pre-commit + commit-msg                  |
| lint-staged   | `package.json#lint-staged`            | 提交前对暂存文件跑 prettier              |
| commitlint    | `commitlint.config.js`                | Conventional Commits（支持中文 subject） |

> `better-sqlite3` 是原生模块，已加入 `pnpm.onlyBuiltDependencies` 白名单。生产路径走 Postgres，SQLite 只给 `src/lib/crawler/storage/sqlite-storage.ts` 留作"脱机调试"备胎。

## 进一步阅读

- 全貌入口：[`docs/getting-started/architecture.md`](docs/getting-started/architecture.md)
- 当前进度：[`docs/getting-started/roadmap.md`](docs/getting-started/roadmap.md)
- 数据模型：[`docs/reference/data-model.md`](docs/reference/data-model.md)
- API 契约：[`docs/reference/api-spec.md`](docs/reference/api-spec.md)
- 看板规格：[`docs/reference/dashboard-spec.md`](docs/reference/dashboard-spec.md)
- 部署：[`docs/deploy/deployment.md`](docs/deploy/deployment.md)
- 重大变更：[`docs/rfcs/`](docs/rfcs/)
