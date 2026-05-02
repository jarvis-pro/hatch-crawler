# API 规范

> 所有 REST 路由在 `src/app/api/**/route.ts`，SSE 在 `src/app/sse/**/route.ts`。
> JSON 入出，统一响应包装在 `src/lib/api/response.ts` —— `ok()` / `fail()` / `failValidation()` / `failInternal()`。

## 通用约定

### 响应包装

成功：

```json
{ "ok": true, "data": <T> }
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "spiderId 字段缺失",
    "details": <unknown>
  }
}
```

### 错误码

| code               | HTTP | 含义                                   |
| ------------------ | ---- | -------------------------------------- |
| `VALIDATION_ERROR` | 400  | 参数不合法（Zod 校验失败）             |
| `NOT_FOUND`        | 404  | 资源不存在                             |
| `CONFLICT`         | 409  | 状态冲突（如对非 running run 调 stop） |
| `INTERNAL_ERROR`   | 500  | 兜底                                   |

### 鉴权

不做。所有路由匿名可访问，假设单用户本地环境。

### 分页

列表接口公约 `?page=1&pageSize=20`，返回 `{ data: T[], total, page, pageSize }`。具体过滤参数见各接口。

---

## Spiders

### `GET /api/spiders`

列出全部 spider。返回 `Spider[]`（见 [data-model.md](./data-model.md)）。

### `POST /api/spiders`

创建 spider。

```json
{
  "type": "youtube-search",
  "name": "YouTube 搜索 - 健身",
  "description": "可空",
  "startUrls": [],
  "allowedHosts": [],
  "maxDepth": 2,
  "concurrency": 4,
  "perHostIntervalMs": 500,
  "enabled": true,
  "cronSchedule": null,
  "defaultParams": { "query": "fitness" },
  "platform": "youtube"
}
```

返回创建后的 `Spider`。`cronSchedule` 写入后会同步到 pg-boss schedule。

### `GET /api/spiders/:id`

> URL 参数 `:id` 是 spiders.id UUID（路由文件名是 `[name]`，承载 id）。

单个 spider 详情。

### `PUT /api/spiders/:id`

更新 spider（全量替换字段）。请求体同 POST。`cronSchedule` 变化时同步 pg-boss schedule。

### `DELETE /api/spiders/:id`

删除 spider；先清除对应 cron schedule。

### `GET /api/spiders/registry`

返回代码注册表里全部可用 spider 类型，用于"新建 Spider"下拉框。

```json
{ "ok": true, "data": [{ "name": "youtube-search", "platform": "youtube" }, ...] }
```

---

## Runs

### `POST /api/runs`

创建并入队一次抓取。

```json
{
  "spiderId": "<uuid>",
  "overrides": { "query": "..." }
}
```

返回 `{ id }`。spider 不存在 → 404；spider 被 disable → 409。

### `GET /api/runs`

```
?spiderId=&status=queued,running&page=1&pageSize=20
```

`status` 用逗号分隔多值。返回标准分页结果。

### `GET /api/runs/:id`

单个 run 详情。

### `DELETE /api/runs/:id`

删除单个 run。`running` / `queued` 不允许删（409）。

### `DELETE /api/runs`

批量删除：

```json
{ "ids": ["<uuid>", "<uuid>"] }
```

返回 `{ deleted: <number> }`。运行中/排队中的会被自动跳过，不报错。

### `POST /api/runs/:id/stop`

停止 running run：触发进程内 `AbortSignal`，立即把 status 标为 `stopped`。非 running → 409。

### `GET /api/runs/:id/events`

```
?level=&page=1&pageSize=100
```

读 events 表。levels：`debug` / `info` / `warn` / `error`。

---

## URL 提取（按链接抓）

### `POST /api/extract`

按用户提交的 URL 列表创建一次"按链接抓取"运行；走内置 `url-extractor` spider。

```json
{ "urls": ["https://www.youtube.com/watch?v=..."] }
```

约束：1..50 条，会 trim + 去重。

返回：

```json
{ "ok": true, "data": { "runId": "<uuid>", "accepted": 3, "rejected": ["bad url"] } }
```

- `rejected` = 本批中"格式非法（new URL 抛错）"的字符串，不进 run。
- "格式合法但 host 不被支持"的 URL **仍然进 run**，由 spider 在 parse 时记 error 跳过——便于用户从 events 表回溯。

进度看 `/sse/runs/:runId/logs`；结果 `GET /api/items?runId=:runId`。

---

## Items

### `GET /api/items`

```
?spider=&type=&runId=&q=&platform=&kind=&page=1&pageSize=20
```

`q` 走 payload 全文 / title 模糊匹配（取决于 repository 实现）。

### `GET /api/items/:id`

单个 item 详情；payload 收紧成 `Record<string, unknown>`。

### `DELETE /api/items`

批量删除：

```json
{ "ids": [1, 2, 3] }
```

返回 `{ deleted: <number> }`。

### `GET /api/items/:id/download`

流式代理下载，触发浏览器原生下载进度条。

```
?url=<source-url>&fetcher=http|ytdlp&audioOnly=false&quality=best|1080p|720p|480p|360p
```

- `fetcher=http`（默认）：`got.stream` 把源 URL 直接 pipe 给浏览器，`Content-Type` / `Content-Length` 透传。
- `fetcher=ytdlp`：spawn `yt-dlp` 下载到临时目录，完成后流式回传，结束后自动清理。
- 客户端断开（`signal.aborted`）→ 销毁 `got` stream / `kill` yt-dlp 进程。
- `audioOnly=true`（仅 ytdlp）输出 mp3。
- `quality` 控制 yt-dlp 选择的视频清晰度上限。

### `POST /api/items/:id/formats`

按需调用 `yt-dlp --dump-json` 解析该 URL 的可用格式，写入 `payload.videoFormats` 并返回结果。

返回：

```json
{
  "ok": true,
  "data": {
    "formats": [{ "height": 1080, "size": 12345678 }, ...],
    "hasAudio": true,
    "audioSize": 1234567
  }
}
```

---

## Accounts

### `GET /api/accounts`

```
?platform=youtube
```

不带 `platform` 返回全部。`payload_enc` 字段不会回传（仓库层显式 omit）。

### `POST /api/accounts`

```json
{
  "platform": "youtube",
  "label": "alt 1",
  "kind": "apikey",
  "payload": "AIza...",
  "expiresAt": "2026-12-31T00:00:00Z"
}
```

`payload` 在 server 侧用 AES-256-GCM 加密后入库。返回 201。

### `PATCH /api/accounts/:id`

```json
{ "action": "unban" }
```

把 status 重置为 `active`、`failure_count` 清零。目前只支持 `unban`。

### `DELETE /api/accounts/:id`

物理删除。

### `POST /api/accounts/:id/test`

轻量验证凭据，更新 `last_tested_at` / `last_test_ok`。返回：

```json
{ "ok": true, "data": { "valid": true, "message": "YouTube API Key 有效" } }
```

- `youtube + apikey`：调 `videos.list`（消耗 1 配额单位），失败时把 Google 返回的 message 透传。
- 其他平台/类型：直接 `valid=true`，标 message 说明无远程验证。

---

## Settings

### `GET /api/settings/:key`

```json
{ "ok": true, "data": { "key": "webhook_url", "value": "https://..." } }
```

不存在的 key 返回 `value: null`，不报 404。

### `PUT /api/settings/:key`

```json
{ "value": <any-json> }
```

upsert。

### `POST /api/settings/webhook_test`

读取 `settings.webhook_url`，发送一次 `{ event: "test", message, at }` 测试包，10s 超时。
未配置 → 400；非 2xx 响应 → 500。

---

## Stats

### `GET /api/stats/summary`

仪表盘头部卡片用：

```json
{
  "running": 0,
  "queued": 0,
  "completed24h": 12,
  "failed24h": 1,
  "totalItems": 12345,
  "newItems24h": 200
}
```

### `GET /api/stats/trend?days=7`

最近 N 天每日新增 items，缺失日填 0。N 取 1..90。

```json
{ "ok": true, "data": [{ "date": "2026-04-26", "count": 12 }, ...] }
```

### `GET /api/stats/breakdown`

items 按平台 / kind 聚合：

```json
{
  "ok": true,
  "data": {
    "byPlatform": [{ "label": "youtube", "count": 1234 }, ...],
    "byKind":     [{ "label": "video",   "count": 5678 }, ...]
  }
}
```

`COALESCE(NULL, '未知')` 统一兜底。

---

## System

### `GET /api/system/health`

检测本机 ffmpeg / yt-dlp 是否可用，5 分钟进程内 cache，看板顶部 banner 用：

```json
{
  "ok": true,
  "data": {
    "ffmpeg": { "ok": true, "version": "6.0" },
    "ytdlp": { "ok": true, "version": "2024.10.07" },
    "checkedAt": 1730000000000
  }
}
```

缺失时 `ok=false` 并附 `installHint`。

---

## SSE

### `GET /sse/runs/:id/logs`

订阅某次 run 的实时事件。返回 `text/event-stream`：

```
event: ready
data: { "runId": "..." }

event: log
data: <CrawlerEvent>

event: done
data: <CrawlerEvent type=done>
```

特性：

- 心跳：30s 发 `: ping` 评论防代理超时
- 终态保护：连接时 run 已结束 → 立即合成 `done` 并关闭，浏览器不会卡住
- 历史回放：先订阅 EventBus 缓冲 live → 从 `events` 表读历史发给前端 → 按 `at` 时间戳去重刷出缓冲的 live 事件
- 客户端：`event === 'done'` 时主动 `es.close()`

`runtime = 'nodejs'`、`dynamic = 'force-dynamic'` —— 不能被静态化。

---

## CrawlerEvent 类型

定义在 `src/lib/shared/events.ts`：

| type           | level        | 关键字段                                                    |
| -------------- | ------------ | ----------------------------------------------------------- |
| `fetched`      | info / debug | `url`, `status`, `durationMs`                               |
| `queued`       | debug        | `url`, `depth`                                              |
| `skipped`      | debug        | `url`, `reason`                                             |
| `emitted`      | info         | `url`, `itemType`, `isNew`                                  |
| `fetch_failed` | warn         | `url`, `attempt`, `error`                                   |
| `error`        | warn / error | `message`                                                   |
| `done`         | info         | `stats: { fetched, emitted, newItems, errors, durationMs }` |

公共字段：`level` / `type` / `at`(epoch ms)。

> `debug` 级事件只走 EventBus，不写 events 表。
