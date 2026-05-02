# 实施路线

> 早期方案曾用 pnpm workspace + monorepo（`packages/*` + `apps/*`），后期收敛为单仓 Next.js 应用。
> 本文记录交付计划，已完成部分同时充当"现在每块在哪儿"的速查；本文只列结论，详细设计请回到 [`architecture.md`](./architecture.md) 与 [`../reference/`](../reference/)。

## 已交付模块

### 1. 爬虫引擎 ✅

```
src/lib/crawler/
├── core/         Fetcher / UrlQueue / Scheduler / BaseSpider + runSpider
├── middleware/   proxy-pool / ua-pool / host rate-limiter
├── parsers/      next-data-parser / html-parser
├── kinds/        Zod schema：article / video / audio / image / post
├── platforms/    youtube / bilibili / xhs / weibo / douyin
├── extractors/   types / registry / youtube
├── spiders/      url-extractor（跨平台）
├── fetcher/      api.ts —— 平台 API 客户端封装
├── storage/      Storage 接口 + 内存 / file / SQLite 实现
├── utils/        logger / url / yt-dlp-formats
└── config/
```

`Storage` 接口让引擎与具体存储解耦：worker 注入 `PostgresStorage`，`scripts/smoke.ts` 注入内存 Storage。

### 2. 多平台抓取 + 凭据管理 ✅

5 个平台共 14 个内置 Spider（详见 `src/lib/spider-registry.ts`），全部接入：

- 自动注入 `accounts` 表中的 `apikey` / `cookie`
- AES-256-GCM 加密存储 payload，主密钥走 `ACCOUNTS_MASTER_KEY`
- 失败计数：spider `consecutive_failures` 超阈值（默认 3）自动 disable；account `failure_count` ≥ 5 自动 ban
- 看板「设置 → 凭据管理」：CRUD + 测试（`/test`）+ 解禁（`PATCH unban`）+ 配额追踪（`quota_used_today`）

Items 三元组定位：`platform` + `kind` + `source_id`，部分唯一索引保证跨 spider/run 同一来源仅一行。

### 3. 多资源类型（Kind 化）✅

`items.kind` ∈ {`article` / `video` / `audio` / `image` / `post`}，每个 kind 对应 `src/lib/crawler/kinds/<kind>.ts` 的 Zod schema。`PostgresStorage` 写入时做软校验（失败 warn 不阻断）。`/items` 列表与详情按 kind 差异化渲染（视频展示封面 + 数字"万/亿"格式 + 下载菜单等）。

### 4. URL 提取（按链接抓）✅

```
/api/extract  ──→  url-extractor spider  ──→  extractors/registry  ──→  emit VideoItem
                                                  └─ youtube
```

用户在看板粘贴 1..50 条 URL → 创建 run → spider 按 host 路由到对应 extractor → 不识别的 URL 仅 ctx.log error，不让 run 失败。新平台只需在 `extractors/<platform>/` 加一个 `Extractor` 实现并在 `extractors/registry.ts` push 一行。

### 5. 看板 + API + SSE + 进程内 Worker ✅

```
src/instrumentation.ts          → 启动期：runMigrations + ensureBuiltinSpiders + startWorker

src/app/
├── dashboard/page.tsx          统计 + 趋势 + breakdown + 最近 Run
├── spiders/page.tsx + [id]/    Spider 列表/详情
├── runs/page.tsx + [id]/       Run 列表/详情（SSE 实时日志 + 历史回放）
├── items/page.tsx + [id]/      Items 列表/详情（视频下载菜单）
├── settings/page.tsx           凭据 / 代理 / 通知 / 下载 / UA / 默认参数
├── api/                        REST：spiders / runs / items / extract / accounts /
│                               settings / stats / system / spiders/registry
└── sse/runs/[id]/logs/         实时日志 + 历史事件回放（首连补帧去重）

src/lib/worker/
├── index.ts                    startWorker / abortRun / syncSpiderSchedule（cron）
├── job-handler.ts              单 job：注入凭据/代理 → runSpider → 自动停用 + Webhook
├── postgres-storage.ts         Storage 实现 + kind schema 软校验
└── event-bus.ts                runId → channel
```

新增依赖：`@prisma/client`、`prisma`、`pg-boss`、`got`、`pino`、`zod`、`@radix-ui/*`、`lucide-react`、`sonner`。

### 6. 视频按需流式下载 ✅

不走持久队列，避免离线媒体仓库的复杂度：

- `GET /api/items/:id/download?fetcher=http|ytdlp&audioOnly&quality` —— 流式 pipe 给浏览器，触发原生下载进度条
- `POST /api/items/:id/formats` —— `yt-dlp --dump-json` 探测可用清晰度并写回 `payload.videoFormats`
- `GET /api/system/health` —— 检测 ffmpeg / yt-dlp 可用性（5 分钟 cache）
- Dockerfile 内置 `ffmpeg + yt-dlp`，本地 dev 用 `brew install`

> 历史包袱：早期有完整 attachments 队列 + 离线下载，已下线（参考 [`../rfcs/0002-media-downloads.md`](../rfcs/0002-media-downloads.md)）。

### 7. Cron 调度 + Webhook 通知 ✅

- spider.cron_schedule 写入 → `syncSpiderSchedule(id, cron)` 在 pg-boss 上注册 `crawl-cron:<id>` 队列 → 到点产出 `triggerType='cron'` 的 run
- run 终态时根据 `settings.webhook_url` POST `{ event, runId, spider, status, errorMessage?, at }`，10s 超时

### 8. Docker Compose 一键起 ✅

`postgres` + `web` 两个容器；instrumentation 钩子自动跑迁移 + 起 worker。详见 [`../deploy/deployment.md`](../deploy/deployment.md)。

---

## 工作量一览

| 模块                 | 实际位置                                                            | 状态 |
| -------------------- | ------------------------------------------------------------------- | ---- |
| 爬虫引擎             | `src/lib/crawler` + `src/lib/shared`                                | ✅   |
| Postgres + pg-boss   | `src/lib/db` + `scripts/db-*`                                       | ✅   |
| 看板 + API + Worker  | `src/app` + `src/lib/worker`                                        | ✅   |
| Docker Compose       | 根 `Dockerfile` + `docker-compose.yml`                              | ✅   |
| Kind 化              | `src/lib/crawler/kinds`                                             | ✅   |
| 多平台 + 凭据管理    | `src/lib/crawler/platforms` + `src/lib/db/repositories/accounts.ts` | ✅   |
| URL 提取（按链接抓） | `src/lib/crawler/extractors` + `src/app/api/extract`                | ✅   |
| 视频按需流式下载     | `src/lib/downloads` + `/api/items/:id/{download,formats}`           | ✅   |
| Cron 调度            | `src/lib/worker/index.ts#syncSpiderSchedule`                        | ✅   |
| Webhook 通知         | `src/lib/worker/job-handler.ts#notifyWebhook`                       | ✅   |

## 验收清单

### 已完成

- [x] `docker compose up` 一行起所有服务
- [x] 浏览器打开 `http://localhost:3000` 看到 Dashboard
- [x] 点"新建运行"能选 Spider + 调参 + 启动
- [x] 跳到 Run 详情看实时日志（SSE 推送）
- [x] Run 完成后能在 Items 页查到结果（按 platform / kind 筛选）
- [x] 配置代理 → 重新运行 → 日志里看到代理生效
- [x] 设 cron → 自动到点跑（pg-boss schedule）
- [x] 历史 Run 列表分页 + 批量删除
- [x] Items 全文搜索 + 平台/kind 过滤
- [x] 类型检查 + ESLint + Prettier 全过
- [x] Web 重启后正在跑的 run 被正确标记为 failed（stale-run cleanup）
- [x] 5 平台抓取（YouTube / Bilibili / 小红书 / 微博 / 抖音），accounts 自动注入
- [x] 5 种 kind（article / video / audio / image / post），看板 kind 差异化渲染
- [x] 凭据失败自动 ban，看板可解禁 + 远程验证
- [x] Spider 连续失败自动 disable + Webhook 告警
- [x] `/api/extract` 按 URL 列表抓取，不识别 URL 不让 run 失败
- [x] 视频详情页"下载"菜单（http / yt-dlp / 仅音频 / 多分辨率）
- [x] `/api/items/:id/formats` 实时探测 yt-dlp 可用格式

### 待完成（仍开放）

- [ ] **RFC 0001 4 层抽象**：现状是平台目录已按 `platforms/<name>/` 组织，但还没正式抽出 `Platform` 接口对象（auth/sign/fetcher 配置驱动）。状态见 [`../rfcs/0001-multi-platform.md`](../rfcs/0001-multi-platform.md)
- [ ] **proxy 池健康度自动剔除**：proxy 失败计数 + 自动暂停（参考 accounts ban 机制）
- [ ] **批量 URL 提取的预校验**：当前只能在 spider parse 时知道 URL 是否被支持，应在 `/api/extract` 入口直接给前端可视反馈
- [ ] **认证**：当前不做（单用户本地）；多人时再加 NextAuth

### 已下线 / 不再做

- ~~RFC 0002 媒体下载/转码管道~~：attachments 表 + download 队列 + 转码 worker 全部移除，改为按需流式下载。详见 [`../rfcs/0002-media-downloads.md`](../rfcs/0002-media-downloads.md) 顶部状态。
- ~~visited 表 / 跨 run URL 去重~~：依赖 `(platform, source_id)` 部分唯一索引 + `(spider, url_hash, content_hash)` 双层去重已经够用。
- ~~Next.js Blog Spider~~：早期 demo spider，已从注册表移除。
- ~~CLI 形态~~：交互全部走看板；引擎自测用 `pnpm smoke`。
