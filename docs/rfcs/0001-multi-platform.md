# RFC 0001 — 多平台 / 多资源类型扩展

| 状态     | **Partially Implemented** (2026-05-01)                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 作者     | hatch-crawler core                                                                                                                                                                                |
| 创建于   | 2026-05-01                                                                                                                                                                                        |
| 影响范围 | 业务 schema 增列、Spider 接口拆分；需要数据迁移（已落地）                                                                                                                                         |
| 关联     | [`getting-started/architecture.md`](../getting-started/architecture.md) · [`getting-started/roadmap.md`](../getting-started/roadmap.md) · [`reference/data-model.md`](../reference/data-model.md) |

## 落地状态（2026-05-01）

- ✅ items 表 `platform` / `kind` / `source_id` 三列与部分唯一索引已上线
- ✅ `src/lib/crawler/kinds/` 5 个 Zod schema（article / video / audio / image / post）
- ✅ `src/lib/crawler/platforms/<p>/spiders/*` 5 个平台共 14 个 Spider
- ✅ accounts 表 + AES-256-GCM 加密 + 自动 ban / unban
- ⏳ 4 层抽象（Platform 配置对象 + auth/sign/fetcher 配置驱动）尚未抽出，目前各平台自己实现 helpers + parsers，没有统一接口

下面是当时的提案原文，记录权衡过程。

---

> **背景：** 当前代码以单平台 / 单一 article 类型（`nextjs-blog-spider`）跑通；
> 本 RFC 提案下一阶段架构：支持"视频 / 音频 / 图片 / 文案 …多种资源类型 × 多种平台（YouTube / B 站 / 小红书 / 抖音 …）"。
> 落地前请同步 review 本文 + 配套的 architecture / data-model / roadmap 三处增量提案小节。
> 状态值约定：`Draft` → `Accepted` → `Implemented` → `Superseded`。

## 设计目标

支撑两个正交维度的扩展：

- **平台**：YouTube、Bilibili、小红书、抖音、Twitter / X、微博、知乎、公众号 …
- **资源类型**：视频、音频、图片、文章、短贴、个人主页、评论 …

约束：

- 每加一个平台，工作量必须可控（写 1 个 Platform + 若干 Spider，不需要动核心模块）
- 每加一个资源类型，工作量必须可控（写 1 个 Zod schema + 前端一段渲染）
- 不为每种类型 / 平台开新表，业务 schema 保持稳定
- 元数据抓取 & 媒体文件下载分离，互不阻塞

非目标（本提案不考虑）：

- 自动绕过付费 / 登录墙之外的内容（用户提供凭据除外）
- 视频转码 / 后处理（落 raw 文件即可，OCR / ASR / 摘要走另一个 enrich 队列）
- 多租户 / 多用户隔离

## 四层抽象

设计核心是把当前的"一个 Spider 类全包"裂成 4 层，各层互相正交。

### 1. Platform —— 这家网站长啥样

每个平台一份 `Platform` 描述对象，刻画"在这个站上抓任何东西的共性"：

```ts
// src/lib/crawler/platforms/<platform>/index.ts
export interface Platform {
  id: string; // 'youtube' | 'bilibili' | 'xhs' | 'douyin' | ...
  displayName: string;

  // 默认 fetch 策略
  fetcher: FetcherKind; // 'http' | 'playwright' | 'api'
  requiresJsRender: boolean;

  // 鉴权
  auth: {
    kind: 'none' | 'cookie' | 'oauth' | 'apikey' | 'signed';
    // 平台特定的签名 / 注入逻辑
    sign?: (req: Request, account: Account) => Request;
  };

  // 反爬偏好
  defaults: {
    perHostIntervalMs: number;
    concurrency: number;
    proxyTier: 'none' | 'datacenter' | 'residential';
    uaPool: 'desktop' | 'mobile' | 'platform-app';
  };

  // 平台原生 ID 提取（比 url 更稳定的去重 key）
  extractSourceId: (url: string) => string | null;

  // 合规
  respectsRobotsTxt: boolean;
  tosUrl?: string;
}
```

物理上：

```
src/lib/crawler/platforms/youtube/
├── index.ts       Platform 描述对象
├── auth.ts        cookie 注入 / OAuth 刷新 / 接口签名
├── parsers.ts     InnerTube response、ytInitialData 解析
├── helpers.ts     共享工具（CONTINUATION token、视频清晰度选择）
└── spiders/       这个平台的具体抓取入口（见下一层）
    ├── channel-videos.ts
    ├── search.ts
    └── playlist.ts
```

`Platform` 是单例 / 静态描述；运行时由 `spider-registry` + `platform-registry` 通过 `id` 注册查找。

### 2. Spider —— 在某平台上的一种入口策略

Spider 退化为"给一个 `Platform`，定义起点和遍历策略"。它不再独自承担平台知识：

```ts
// src/lib/crawler/platforms/youtube/spiders/channel-videos.ts
export class YoutubeChannelVideosSpider extends BaseSpider {
  override readonly name = 'youtube/channel-videos';
  override readonly platform = 'youtube';
  override readonly emitsKinds = ['video'] as const;

  // params 由 Run 创建时传入（看板表单）
  override async start(ctx: SpiderContext, params: { channelId: string }) {
    // 通过 ctx.platform.fetcher 调 InnerTube browse
    // 翻页 / 解析 → emit video items + enqueue 详情页
  }
}
```

关键点：

- 一个平台可以有 N 个 Spider（`channel-videos` / `search` / `playlist` / `single-video`）
- Spider 只关心"流程"：从哪个 URL 开始、怎么翻页、哪些信息要进详情
- 平台知识（签名、解析器、auth）通过 `ctx.platform` 取，不直接写死
- 一个 Spider 声明 `emitsKinds`，Run 的统计可以按 kind 拆分

### 3. Resource Kind —— 抓到的是什么

定义一组标准化的"资源类型"，每种 kind 对应一份 Zod schema：

```ts
// src/lib/crawler/kinds/video.ts
export const VideoItem = z.object({
  // 通用
  platform: z.string(),
  kind: z.literal('video'),
  sourceId: z.string(),
  url: z.string().url(),
  title: z.string(),
  description: z.string().optional(),
  author: z.object({ id: z.string(), name: z.string(), url: z.string().url() }).optional(),
  publishedAt: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),

  // 视频专属
  durationMs: z.number().int().nonnegative().optional(),
  metrics: z
    .object({
      views: z.number().int().optional(),
      likes: z.number().int().optional(),
      comments: z.number().int().optional(),
      shares: z.number().int().optional(),
    })
    .optional(),

  // 媒体文件清单（不下载，只列 URL）
  media: z.array(
    z.object({
      kind: z.enum(['video', 'audio', 'thumbnail', 'subtitle']),
      url: z.string().url(),
      mime: z.string().optional(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      bitrate: z.number().int().optional(),
      lang: z.string().optional(),
    }),
  ),

  // 平台原始数据兜底
  raw: z.record(z.unknown()).optional(),
});
export type VideoItem = z.infer<typeof VideoItem>;
```

类似地：

```
src/lib/crawler/kinds/
├── video.ts       视频
├── audio.ts       音频 / 播客 / 单曲
├── image.ts       图集 / 单图
├── article.ts     长文 / 博客 / 公众号文章
├── post.ts        短贴 / 微博 / 推文
├── profile.ts     用户主页 / 频道
├── comment.ts     评论
└── index.ts       Discriminated union: ResourceItem
```

Spider 在 `emit` 时必须吐出符合某个 kind schema 的 payload，否则 worker 报 validation error。
**前端不再 per-platform 写 view**——按 kind 渲染，YouTube 视频和 B 站视频在 `/items` 页面长一样。

### 4. Pipeline —— 元数据 / 媒体 / 后处理 三条管道

爬虫只抓"元数据 + 媒体 URL"。**媒体下载是另一条 pipeline**。pg-boss 多个队列实现：

```
crawl     队列  ← Spider 跑（现有）
download  队列  ← 拉媒体文件（新增）
enrich    队列  ← 后处理：OCR / ASR / 摘要 / 翻译（可选，新增）
```

数据流：

```
Spider runs → emit ResourceItem → 写 items 表
                                 → 解析 item.media[]，按 URL 推 download job
download worker → 拉文件 → 写对象存储 → 更新 assets 表
                                       → emit assets.ready → 触发 enrich job（可选）
```

理由：

- 元数据轻、能高并发；媒体重、要节流防 ban，混在一起两边都做不好
- 媒体可能是 m3u8 / DASH 分片或需要 yt-dlp 兜底，逻辑独立、可单独迭代
- 用户可能只要元数据不下文件——分开后是配置开关，不分开就是改代码

## 数据模型增量

详见 [`../reference/data-model.md`](../reference/data-model.md) 的"下一阶段提案"小节，这里给概览。

### `items` 表加列

```ts
platform: varchar(32).notNull(),       // 'youtube'
kind: varchar(16).notNull(),           // 'video' | 'audio' | 'image' | 'article' | ...
sourceId: varchar(128).notNull(),      // 平台原生 ID（YouTube videoId / B 站 BV / 抖音 awemeId）
```

唯一约束从 `(spider, urlHash, contentHash)` 升级为 `(platform, sourceId)`：跨域名 / 跨重定向 / 跨 spider 都稳定。

### 新表 `assets`

```ts
{
  id: serial,
  itemId: int references items(id) on delete cascade,
  kind: enum('video','audio','image','thumbnail','subtitle'),
  originalUrl: text,
  mime: varchar(64),
  sizeBytes: bigint,
  width: int, height: int, durationMs: int, bitrate: int,
  storagePath: text,             // 'local:/data/assets/...' or 's3://bucket/...'
  checksum: char(64),            // sha256
  status: enum('pending','downloading','ready','failed','skipped'),
  errorMessage: text,
  createdAt, updatedAt,
}
```

Index：`(itemId)`、`(status)`（download worker 拉 pending）、`(checksum)`（去重）。

### 新表 `accounts`

```ts
{
  id: serial,
  platform: varchar(32),
  label: varchar(64),                          // 用户自命名："work-account-1"
  kind: enum('cookie','oauth','apikey','session'),
  payload: text,                               // 加密后存（KMS 或本地 master key）
  expiresAt: timestamp,
  status: enum('active','expired','banned','disabled'),
  lastUsedAt: timestamp,
  failureCount: int default 0,
}
```

Spider 跑时按 platform 查可用 account，注入 fetcher。Cookie 别全压一个账号，按 account 轮换并记录每个账号的 ban 状态。

### 不动的部分

- `runs` / `events` / `visited` / `settings` 不变
- `spiders` 表加 `platform varchar(32)` 一列即可

## 目录结构演进

```
src/lib/crawler/
├── core/                  ← 不变（Fetcher / Queue / Spider / Scheduler）
├── platforms/             ← 新：每平台一个子目录
│   ├── youtube/
│   ├── bilibili/
│   ├── xhs/
│   ├── douyin/
│   └── ...
├── kinds/                 ← 新：资源类型 Zod schema
│   ├── video.ts / audio.ts / image.ts / article.ts / post.ts / ...
│   └── index.ts
├── fetcher/               ← 升级：从单文件变多策略
│   ├── http.ts            当前实现
│   ├── playwright.ts      可选，未声明 requiresJsRender 不启动 Chromium
│   └── api.ts             平台 API client wrapper（带 auth / 限流 / 签名）
├── downloader/            ← 新：媒体下载器
│   ├── http-stream.ts
│   ├── hls.ts             m3u8 拼接
│   └── ytdlp.ts           yt-dlp 子进程兜底
├── middleware/            ← 现有 proxy / ua / rate，但按 platform 隔离
└── parsers/               ← 通用 parser 留下（next-data / html）
```

`src/lib/worker/` 增加：

```
src/lib/worker/
├── crawl-handler.ts        现有 job-handler.ts 改名
├── download-handler.ts     新：消费 download 队列
├── enrich-handler.ts       新（可选）：消费 enrich 队列
├── asset-store.ts          AssetStore 接口 + LocalFsStore / S3Store 实现
└── ...
```

## 队列与配置

`src/lib/db/boss.ts` 加常量：

```ts
export const QUEUE_CRAWL = 'crawl'; // 现有
export const QUEUE_DOWNLOAD = 'download'; // 新增
export const QUEUE_ENRICH = 'enrich'; // 可选
```

每个队列单独配 `teamSize` / `teamConcurrency`：

| 队列     | 默认并发 | per-host 节流 | 备注                       |
| -------- | -------- | ------------- | -------------------------- |
| crawl    | 4        | 1 r/s         | 元数据，可适度压榨         |
| download | 2        | 1 r/s（同源） | IO 重，开多了反而互相踩    |
| enrich   | 1        | —             | OCR / ASR 跑模型，串行就好 |

## 反模式备忘

落地过程中要时刻警惕：

- **不要写超级 Spider** —— 一个 class 用 `if (platform === ...)` 分平台。半年后没人维护得动，每个平台必须有自己的 Platform/Spider 文件。
- **不要让 Spider 直接 `fs.writeFile` 视频** —— Spider 因下载阻塞，并发上不去，stop 后还在写盘。Spider 是元数据生产者，下载是 download worker 的事。
- **不要把媒体二进制灌 Postgres** —— 元数据进 Postgres，文件进对象存储/FS，`assets.storagePath` 引用之。
- **不要为每种资源类型开新表**（`videos` / `articles` / `images` 各一张）—— 统一 `items` + `kind` + Zod 校验，新增类型不动 schema。
- **不要默认 Playwright** —— 浏览器并发成本是 HTTP 的 50 倍。Playwright 是兜底，只给真没 JSON 接口的平台开。
- **不要在 Spider 里 hardcode 账号 cookie** —— 走 `accounts` 表 + `Auth` middleware，否则切账号要改代码。

## 落地路径（3 步走，每步可独立交付）

详见 [`../getting-started/roadmap.md`](../getting-started/roadmap.md) 中"下一阶段：多平台"提案小节。要点：

1. **Phase 5：Kind 化 + 平台标记**。`items` 加 `platform` / `kind` / `sourceId` 三列；建 `kinds/` 目录定义 4-5 个核心 schema；现有 `nextjs-blog` 标 `platform='nextjs-blog'` / `kind='article'`，跑通 schema → emit → repo 流量。
2. **Phase 6：第一个真平台**。挑一个有公开 API 的（YouTube Data API 或 Bilibili 公开接口）按 Platform/Spider 分层写出来。这一步会暴露 fetcher / auth / parser 的抽象到底好不好——第二个平台写得疼就回去改抽象，别忍。
3. **Phase 7：媒体下载管道**。`assets` 表 + `download` 队列 + `AssetStore` 接口；先实现本地 FS，对象存储（S3 / R2 / MinIO）作为可选实现。

每个 Phase 都不影响现有 Phase 1-4 的运转，看板可以一直跑。

## 合规与边界

多平台一上规模，平台风控会上心。从第一个新平台起就加：

- 每个 `Platform` 带 `respectsRobotsTxt` 和 `tosUrl`，默认开 robots.txt 检查（`robots-parser`）
- per-host QPS 默认压到 1 r/s，用户调高要二次确认
- "抓什么 / 不抓什么"做成 Spider 的显式 URL 白名单参数，不要无脑深度优先
- `accounts` 表里凭据一定加密存储（先用本地 master key，后续阶段接 KMS）
- 看板首页 / spider 详情页都标注"使用本工具抓取受 TOS 约束的内容由用户自负责"

## 待定

下面这些先不在本提案范围里，但目录 / 接口要预留：

- 多账号 cookie 池的健康监控（自动检测 ban 并切换）
- 增量抓取的 Watermark 机制（YouTube channel 上次抓到哪条 videoId 之后）
- WebHook 通知（新 item 进库时 push 给外部系统）
- 全文检索（Postgres tsvector 或 Meilisearch sidecar）

落地后回来评估优先级。
