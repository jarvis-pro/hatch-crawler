# RFC 0002 — 媒体下载与转码（含 YouTube）

| 状态     | **Draft** (2026-05-01)                                                                                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 作者     | hatch-crawler core                                                                                                                                                                                                                                   |
| 创建于   | 2026-05-01                                                                                                                                                                                                                                           |
| 影响范围 | **加性**：新增 1 张表、2 条 pg-boss 队列、若干 API 与看板 UI；**新增系统依赖** `ffmpeg` 与 `yt-dlp`；既有 spider/worker 接口不破坏                                                                                                                   |
| 关联     | [RFC 0001 §"四层抽象 → Storage"](./0001-multi-platform.md) · [`getting-started/architecture.md`](../getting-started/architecture.md) · [`reference/data-model.md`](../reference/data-model.md) · [`reference/api-spec.md`](../reference/api-spec.md) |

---

> **背景：** 当前抓取链路只落 item 元数据（jsonb payload），不下载二进制。
> 用户希望支持下载 item 关联的媒体文件（mp4 / mp3 / wav / m4a / zip / pdf 等），并能把视频转成音频。
> RFC 0001 已经把"元数据抓取 & 媒体文件下载分离"作为目标但未给出实现，本 RFC 是它的具体落地。

## 设计目标

1. **下载与抓取解耦**：抓取 run 永远只负责元数据；下载是另一组 job，慢/大/失败也不阻塞 spider。
2. **手动 + 自动两种触发都支持**：默认手动；spider 可以打开 `autoDownload`，run 完成时自动派发下载。
3. **统一的 attachment 模型**：item 与文件多对多分离，一个 item 可以挂"原始视频 + 转码音频 + 缩略图"。
4. **YouTube 也走同一框架**：YouTube Data API 不返回播放 URL，引入 `yt-dlp` 作为 fetcher 适配，仍写入 `attachments` 表。
5. **进度可观察**：看板能看到 queued / downloading（带 % 与速度）/ completed / failed 四态，详情页可看错误。
6. **可扩展存储**：先本地 `data/downloads/`，留 `STORAGE_BACKEND` 环境变量，未来可换 S3/MinIO 不破坏 API。

非目标：

- **HLS / DASH 流的自实现拼包**——交给 yt-dlp / ffmpeg 处理。
- **多租户 / 配额**——单用户/单组织部署内自洽。
- **下载 CDN 加速**——本地存储就行，性能问题等到出现再优化。

## 关键决策清单

| 决策点               | 选择                                                             | 理由 / 备注                                             |
| -------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| 抓取与下载是否同进程 | **同进程**（复用现有 web+worker 单进程模式）                     | 与 RFC 0001 保持一致；要拆出去再开 RFC                  |
| 队列实现             | **新增两条 pg-boss 队列**：`download` 和 `transcode`             | 队列分离避免大文件挤占 crawl 并发；pg-boss 已是事实标准 |
| 文件存储             | 本地 `data/downloads/<spider>/<itemId>/<attachmentId>.<ext>`     | 走 `Storage` 抽象，环境变量预留 S3                      |
| 进度上报             | got `downloadProgress` → EventBus → SSE                          | 复用现有 SSE 通道，前端用 `useEventSource` 订阅         |
| YouTube 视频         | **本期做**，调用 `yt-dlp` 子进程，json 输出解析                  | 见 §"风险与权衡 → YouTube TOS"                          |
| 视频→音频            | **ffmpeg `-vn -acodec libmp3lame -q:a 4`** 转 mp3，按需          | 子进程；进度按 ffmpeg `-progress pipe:1` 解析           |
| 文件去重             | sha256 列 + 唯一索引（同 spider 内）                             | 同 url 不同 run 不重复落盘                              |
| 失败重试             | pg-boss `retryLimit: 3, retryBackoff: true`                      | 与 crawl 队列一致                                       |
| 安全                 | URL 白名单按 host 校验；yt-dlp 子进程 `--no-playlist` 等参数固定 | 防止任意命令注入与意外大批下载                          |

## 数据模型

新增一张 `attachments` 表（参与 RFC 0001 的 Storage 层），与 `items` 多对一：

```prisma
// prisma/schema.prisma 增量（DDL 仍要在 src/lib/db/migrate.ts 同步）
model Attachment {
  id           String   @id @default(uuid()) @db.Uuid
  itemId       String   @map("item_id") @db.Uuid
  spider       String                                              // 冗余便于按 spider 清理
  // 内容
  kind         AttachmentKind                                       // video | audio | image | archive | document | other
  mimeType     String?  @map("mime_type")
  sourceUrl    String   @map("source_url")                          // 远端 URL 或 yt-dlp ID
  fetcherKind  String   @map("fetcher_kind")                        // 'http' | 'yt-dlp'
  // 文件落地
  storagePath  String?  @map("storage_path")                        // 相对 data/ 的路径
  byteSize     Int?     @map("byte_size")
  sha256       String?
  // 转码派生
  parentId     String?  @map("parent_id") @db.Uuid                  // 转码产物指回原始 attachment
  transcodeOp  String?  @map("transcode_op")                        // 'video_to_mp3' 等
  // 状态机
  status       AttachmentStatus @default(queued)                    // queued | downloading | transcoding | completed | failed
  progressPct  Int?     @map("progress_pct")                        // 0-100
  errorMessage String?  @map("error_message")
  // 审计
  createdAt    DateTime @default(now()) @map("created_at")
  startedAt    DateTime? @map("started_at")
  finishedAt   DateTime? @map("finished_at")

  item   Item        @relation(fields: [itemId], references: [id], onDelete: Cascade)
  parent Attachment? @relation("transcode", fields: [parentId], references: [id])
  derived Attachment[] @relation("transcode")

  @@index([spider, status])
  @@index([itemId])
  @@unique([spider, sha256])  // 同 spider 同内容只落一份盘
  @@map("attachments")
}

enum AttachmentKind { video; audio; image; archive; document; other }
enum AttachmentStatus { queued; downloading; transcoding; completed; failed }
```

`spiders` 表加一列：

```prisma
autoDownload  Boolean  @default(false) @map("auto_download")
```

`runs` 表加聚合统计（可选，方便看板）：

```prisma
attachmentsQueued    Int @default(0) @map("attachments_queued")
attachmentsCompleted Int @default(0) @map("attachments_completed")
attachmentsFailed    Int @default(0) @map("attachments_failed")
```

按 [CLAUDE.md](../../CLAUDE.md) 「改 schema 的标准动作」：上述变化必须**同步**改 `prisma/schema.prisma` + `src/lib/db/migrate.ts` + `src/lib/db/index.ts`。

## 系统架构

```
┌─────────────────────────┐    ┌────────────────────────────┐
│  crawl run（已有）       │    │  download job（新）         │
│  spider.parse 出 item    │───▶│  fetcher: http | yt-dlp    │
│  + 可选附件元数据         │    │  写文件 → attachments 表    │
└─────────────────────────┘    └────────────────────────────┘
            │                              │
            │ autoDownload=true            │ ctx.emit('attach_request')
            ▼                              ▼
   pgboss.send('download', ...)   ┌────────────────────────────┐
                                  │  transcode job（新）        │
                                  │  ffmpeg：video → mp3       │
                                  └────────────────────────────┘
                                              │
                                              ▼
                                  EventBus → SSE → 看板
```

### 下载触发的三条路径

1. **手动**：看板 item 详情点「下载」 → POST `/api/items/:id/attachments` → pgboss.send('download')
2. **自动**：spider run 完成时，job-handler 扫描本次 run 产出的 items，对带 `autoDownload` 标记的 spider 批量入队
3. **API 直派**：HTTP `POST /api/attachments` 给定 `{ itemId, sourceUrl, kind }`，给外部脚本/调度用

### Spider 侧 API 增量

`SpiderContext` 不强制 spider 关心下载，但提供一个**声明式**入口：

```ts
// 现有：
ctx.emit({ url, type, payload, ... });

// 新增：
ctx.attach({
  url: 'https://example.com/foo.mp4',  // 远端 URL；yt-dlp 路径用 'ytdlp:<videoId>'
  kind: 'video',                        // 由 spider 标
  fetcherKind: 'http',                  // 默认 http；YouTube spider 出 'yt-dlp'
});
```

`ctx.attach` 内部不立即下载，只把 attachment 信息存入 EventBus 并由 job-handler 决定是否当场入队（autoDownload=true）或仅落 attachments 表 status=queued。

## 文件存储抽象

```ts
// src/lib/storage/files.ts (新)
export interface FileStorage {
  put(relPath: string, stream: Readable): Promise<{ size: number; sha256: string }>;
  get(relPath: string): Promise<Readable>;
  delete(relPath: string): Promise<void>;
  publicUrl(relPath: string): string; // 看板下载链接
}

export class LocalFileStorage implements FileStorage {
  /* data/downloads/* */
}
// 未来：S3FileStorage / MinioFileStorage 同接口
```

环境变量：`STORAGE_BACKEND=local|s3`（先只实现 local），看板下载链接走新 route `GET /api/attachments/:id/download` 由 server 决定从哪个 backend 读取并 stream。

## Fetcher 适配

```ts
interface AttachmentFetcher {
  kind: string; // 'http' | 'yt-dlp'
  fetch(input: AttachmentJobInput, ctx: AttachCtx): Promise<AttachmentResult>;
}

interface AttachCtx {
  signal: AbortSignal; // 接 stop 按钮
  onProgress: (pct: number, bytes: number, totalBytes?: number) => void;
}
```

- **HttpFetcher**：用现有的 `got`，开 `decompress: true` + stream + `downloadProgress` 回调。
- **YtdlpFetcher**：spawn `yt-dlp -j --no-playlist --no-warnings -o '<tmp>/%(id)s.%(ext)s' <url>`，捕获 stderr 上的进度行。

## 转码

```ts
// pg-boss 'transcode' job
// payload: { attachmentId, op: 'video_to_mp3' }
// 实现：spawn ffmpeg -i <src> -vn -acodec libmp3lame -q:a 4 -progress pipe:1 <dst>
// 解析 -progress 输出更新 attachments.progressPct
```

转码完成后插入新的 `attachments` 行 `parentId=src.id, kind=audio, transcodeOp=video_to_mp3`，与原视频共存。

## API 设计

| 方法     | 路径                             | 用途                                                 |
| -------- | -------------------------------- | ---------------------------------------------------- |
| `GET`    | `/api/items/:id/attachments`     | 列出 item 的所有 attachment                          |
| `POST`   | `/api/items/:id/attachments`     | 手动下载：body `{ url, kind, fetcherKind?: 'http' }` |
| `POST`   | `/api/attachments/:id/transcode` | 触发转码：body `{ op: 'video_to_mp3' }`              |
| `GET`    | `/api/attachments/:id`           | 查 attachment 详情（含状态/进度/错误）               |
| `GET`    | `/api/attachments/:id/download`  | 文件下载（HTTP range 支持）                          |
| `DELETE` | `/api/attachments/:id`           | 删除文件 + 数据库行                                  |
| `POST`   | `/api/runs/:id/download-all`     | 把这次 run 的所有可下载 item 入下载队列              |
| `GET`    | `/sse/attachments/:id/progress`  | SSE 推进度（兜底，前端订阅）                         |

复用 `src/lib/api/response.ts` 的 `ok / fail` 包装。

## 看板 UI

| 位置                  | 控件                  | 说明                                                                |
| --------------------- | --------------------- | ------------------------------------------------------------------- |
| `/items/:id`          | 「附件」面板          | 列出 attachment 表格 + 状态/进度条 + 「下载」「转 mp3」「删除」按钮 |
| `/items` 列表         | 行级「下载」按钮      | 对识别为媒体的 item 直接触发                                        |
| `/runs/:id`           | 「批量下载」按钮      | 派发本 run 全部                                                     |
| `/spiders/:name` 编辑 | `autoDownload` 开关   | 默认关                                                              |
| 全局                  | `/attachments` 总览页 | 状态过滤 + 失败重试入口                                             |

进度条用 [shadcn/ui Progress](https://ui.shadcn.com/docs/components/progress)，订阅 `/sse/attachments/:id/progress`。

## 进度上报机制

复用现有 `EventBus`（[src/lib/worker/event-bus.ts](../../src/lib/worker/event-bus.ts)）的发布/订阅模型。新增事件类型：

```ts
type AttachmentEvent =
  | { type: 'attach_queued'; attachmentId: string; ... }
  | { type: 'attach_progress'; attachmentId: string; pct: number; bytes: number; totalBytes?: number; speedBps?: number }
  | { type: 'attach_completed'; attachmentId: string; storagePath: string; byteSize: number }
  | { type: 'attach_failed'; attachmentId: string; error: string };
```

job-handler 不每个 progress 都写库（IO 太多）：节流为**每 2 秒或每 +5% 才更新 `attachments.progressPct`**，实时进度只走 EventBus → SSE。

## 风险与权衡

### 1. YouTube TOS（最大风险）

YouTube TOS §III.E 禁止"下载内容除非提供下载按钮"。yt-dlp 在个人/教育/研究场景广泛使用但**商用风险高**。本 RFC 落地建议：

- 默认在配置里**关闭** YouTube fetcher，需要在 settings 里手动开启
- 看板上 YouTube 下载按钮加确认弹窗 + 法律免责文案
- 不主动并发批量下载（`download` 队列对 `youtube` host 限并发为 1）

### 2. 系统依赖

- `ffmpeg` 与 `yt-dlp` 不是 npm 包，需要：
  - **Dockerfile** 加 `apt-get install -y ffmpeg python3-pip && pip install yt-dlp`
  - **本地 dev** 在 [README.md](../../README.md) 加一段「本地需要 brew install ffmpeg yt-dlp」
  - 启动时检测两者存在，缺失则在看板顶部 banner 提示

### 3. 磁盘膨胀

- 加配置 `STORAGE_MAX_GB`，超过后新下载入队前检查，超限则 fail 并在看板红色提醒
- 看板「Storage」页展示当前占用 + 一键清理 N 天前的失败下载
- 删 spider / item 时级联删 attachment 文件（DB onDelete: Cascade + 后台 GC job）

### 4. 命令注入

- yt-dlp / ffmpeg 子进程**不**用 shell（`spawn` 无 shell, args 数组传参）
- url 字段在入队前用 `URL` 构造校验
- 文件名固定模板 `<attachmentId>.<ext>`，扩展名 whitelist：`mp4 / mp3 / wav / m4a / zip / pdf / jpg / png / webp`

### 5. 进程内并发

- pg-boss 拉取并发设上限：`download` 队列默认 4 并发、`transcode` 默认 2 并发（CPU 密集）
- 同进程跑大文件流不会阻塞 web，但内存峰值要观察；用 stream 不要 `Buffer.concat`

## 实施计划（Phase A → C）

> 每个 Phase 独立可发布，Phase A 完结即"可手动下 mp4/mp3/zip"，Phase C 完结即"可一键 YouTube → mp3"。

### Phase A — 通用直链下载（MVP，预计 1.5 周）

**目标**：手动触发下载任意直链 mp4/mp3/zip/pdf 到本地，看板能看到进度并下载文件。

| 步骤 | 改动                                                                                               | 文件                                                                     |
| ---- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| A-1  | 新增 `attachments` 表 + 加 `spiders.auto_download` + 加 `runs.attachments_*`                       | `prisma/schema.prisma` + `src/lib/db/migrate.ts` + `src/lib/db/index.ts` |
| A-2  | `src/lib/db/repositories/attachments.ts` repository                                                | 新文件                                                                   |
| A-3  | `FileStorage` 接口 + `LocalFileStorage` 实现                                                       | `src/lib/storage/files.ts`                                               |
| A-4  | pg-boss 注册 `download` 队列；新增 `src/lib/worker/download-job-handler.ts`                        | 新文件                                                                   |
| A-5  | `HttpFetcher`：got stream + downloadProgress + sha256                                              | `src/lib/downloads/http-fetcher.ts`                                      |
| A-6  | EventBus 加 `AttachmentEvent` 类型 + 进度节流                                                      | `src/lib/shared/events.ts` + `src/lib/worker/event-bus.ts`               |
| A-7  | API：`POST/GET/DELETE /api/items/:id/attachments`、`GET /api/attachments/:id/download`（带 Range） | `src/app/api/items/[id]/attachments/...`                                 |
| A-8  | SSE：`GET /sse/attachments/:id/progress`                                                           | `src/app/sse/attachments/[id]/progress/route.ts`                         |
| A-9  | 看板：item 详情页加附件面板 + 下载按钮 + 进度条                                                    | `src/app/items/[id]/page.tsx` 等                                         |
| A-10 | Smoke：`scripts/smoke-download.ts` 用一个公开 mp3 URL 跑通                                         | 新文件                                                                   |

**Phase A 验收**：在浏览器对一条 item 点「下载 https://.../sample.mp3」，进度条从 0→100，文件出现在 `data/downloads/`，再点「下载文件」能取回。

### Phase B — 视频转音频（预计 0.5 周）

| 步骤 | 改动                                                                     | 文件                                          |
| ---- | ------------------------------------------------------------------------ | --------------------------------------------- |
| B-1  | pg-boss 注册 `transcode` 队列；`src/lib/worker/transcode-job-handler.ts` | 新文件                                        |
| B-2  | `FfmpegRunner`：spawn ffmpeg + 解析 `-progress pipe:1`                   | `src/lib/downloads/ffmpeg-runner.ts`          |
| B-3  | API `POST /api/attachments/:id/transcode`                                | 新 route                                      |
| B-4  | 看板附件面板：视频行加「转 mp3」按钮 + 派生行展示 parent/derived 关系    | `src/app/items/[id]/page.tsx`                 |
| B-5  | Dockerfile 加 ffmpeg；README 加 brew install 说明；启动检测 + banner     | `Dockerfile` + `README.md` + `src/lib/env.ts` |

**Phase B 验收**：对一个已下载的 mp4 点「转 mp3」，几秒后 attachments 表多一行 audio，能下载播放。

### Phase C — YouTube fetcher（预计 1 周，含合规与 UX）

| 步骤 | 改动                                                                                                       | 文件                                             |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| C-1  | `YtdlpFetcher`：spawn yt-dlp + 解析 stdout/json                                                            | `src/lib/downloads/ytdlp-fetcher.ts`             |
| C-2  | YouTube spider 出 item 时附 `ctx.attach({ url: 'ytdlp:<videoId>', kind: 'video', fetcherKind: 'yt-dlp' })` | `src/lib/crawler/platforms/youtube/spiders/*.ts` |
| C-3  | 下载 job-handler 根据 `fetcherKind` 路由到对应 fetcher                                                     | `src/lib/worker/download-job-handler.ts`         |
| C-4  | settings 新增 `enable_youtube_download` 开关（默认 false）+ 看板 UI 与法律免责文案                         | `src/app/settings/page.tsx`                      |
| C-5  | YouTube host 限并发：`download` 队列加 host 级 rate limit                                                  | `src/lib/worker/download-job-handler.ts`         |
| C-6  | Dockerfile 加 `pip install yt-dlp` + 启动检测                                                              | `Dockerfile` + 启动检测                          |

**Phase C 验收**：在 settings 启用 YouTube 后，对一条 youtube-channel-videos 抓出来的 item 点「下载」，yt-dlp 跑起来，进度条到 100，文件入库；再点「转 mp3」走完 Phase B 路径。

### Phase D — autoDownload + 批量 + 看板总览（预计 0.5 周）

| 步骤 | 改动                                              | 文件                                |
| ---- | ------------------------------------------------- | ----------------------------------- |
| D-1  | spider 编辑表单加 `autoDownload` 开关             | `src/app/spiders/[name]/...`        |
| D-2  | `job-handler.ts` run 完成时按 spider 配置批量派发 | `src/lib/worker/job-handler.ts`     |
| D-3  | `POST /api/runs/:id/download-all` 手动批量入口    | 新 route                            |
| D-4  | `/attachments` 总览页 + 状态过滤 + 重试 + 一键 GC | `src/app/attachments/page.tsx` 新页 |
| D-5  | `STORAGE_MAX_GB` 配额检测                         | `src/lib/env.ts` + 入队前钩子       |

**Phase D 验收**：把 `youtube-channel-videos` 的 `autoDownload` 打开，跑一次 run，自动就把所有视频下载进队列；总览页能看到全部状态。

## 测试策略

- **Phase A 单测**：`HttpFetcher` 用 nock + 内存 stream 验证 sha256/进度回调。
- **Phase B 单测**：`FfmpegRunner` 用一个 1 秒的 sample.mp4 跑真 ffmpeg，CI 装 ffmpeg。
- **Phase C 暂不写真 yt-dlp 单测**：mock 子进程；e2e 在本地手动验。
- **Smoke**：`scripts/smoke-download.ts` 跑公开 mp3 URL；`scripts/smoke-transcode.ts` 跑 sample.mp4。
- **Lint/Type**：`pnpm check` 全绿是 PR 强约束。

## 评审要点

落地 Phase A 之前需要回答：

1. ✅ 媒体文件全部本地存储 OK 吗？还是想直接接 S3？（先本地，预留接口）
2. ✅ YouTube 下载在本期做？（用户已确认：是）
3. ✅ autoDownload 默认值？（默认关）
4. ⚠️ Dockerfile 加 ffmpeg + yt-dlp 会让镜像大约 +200MB，能接受？
5. ⚠️ 磁盘配额 `STORAGE_MAX_GB` 默认值？建议 50GB，待定。

---

> **下一步**：Phase A 开 PR 落地，本 RFC 状态从 `Draft` 改为 `Accepted`。
