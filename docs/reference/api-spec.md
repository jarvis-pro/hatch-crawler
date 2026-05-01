# API 规范

> 所有 API 路由都在 `src/app/api/`（Next.js App Router）。
> SSE 通道单独放在 `src/app/sse/`。
> JSON 入出，遵循统一错误格式（统一包装函数在 `src/lib/api/response.ts`）。

## 通用约定

### 响应格式

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
    "message": "spider 字段缺失",
    "details": { "field": "spider" }
  }
}
```

### 错误码

| code               | HTTP | 含义                       |
| ------------------ | ---- | -------------------------- |
| `VALIDATION_ERROR` | 400  | 参数不合法（Zod 校验失败） |
| `NOT_FOUND`        | 404  | 资源不存在                 |
| `CONFLICT`         | 409  | 状态冲突（比如重复创建）   |
| `INTERNAL_ERROR`   | 500  | 兜底                       |

### 鉴权

当前不做。所有路由匿名可访问。

### 分页

列表接口统一参数：

```
?page=1&pageSize=20&sort=-createdAt
```

返回 `{ data: T[], total: number, page, pageSize }`。

---

## REST 端点

### Spiders

#### `GET /api/spiders`

列出所有 Spider。

**返回：**

```json
{
  "ok": true,
  "data": [
    {
      "name": "nextjs-blog",
      "displayName": "Next.js 官博",
      "description": "...",
      "startUrls": ["https://nextjs.org/blog"],
      "allowedHosts": ["nextjs.org"],
      "maxDepth": 2,
      "concurrency": 4,
      "perHostIntervalMs": 500,
      "enabled": true,
      "cronSchedule": null
    }
  ]
}
```

#### `GET /api/spiders/:name`

单个 Spider 的详情。404 if not found.

#### `PUT /api/spiders/:name`

更新 Spider 配置。

**请求体：**

```json
{
  "displayName": "...",
  "startUrls": ["..."],
  "maxDepth": 3,
  "concurrency": 8,
  "enabled": true,
  "cronSchedule": "0 */6 * * *"
}
```

只允许修改可调参数，`name` 不变。Worker 下次启动 Run 时读取最新值。

---

### Runs

#### `POST /api/runs`

创建一个新 Run（入队）。

**请求体：**

```json
{
  "spider": "nextjs-blog",
  "overrides": {
    "concurrency": 8,
    "maxDepth": 1
  }
}
```

**返回：**

```json
{
  "ok": true,
  "data": { "id": "8a4f9b1c-..." }
}
```

行为：

1. 校验 `spider` 存在且 `enabled = true`
2. 在 `runs` 表插入一行 status = `queued`
3. 通过 `pgboss.send('crawl', { runId, spider, overrides })` 入队
4. 返回 runId

#### `GET /api/runs`

历史 Run 列表。支持过滤：

```
?spider=nextjs-blog&status=running&page=1&pageSize=20
```

**返回每行：**

```json
{
  "id": "...",
  "spiderName": "nextjs-blog",
  "status": "running",
  "fetched": 24,
  "emitted": 24,
  "newItems": 22,
  "errors": 0,
  "startedAt": "2026-04-30T13:50:00Z",
  "finishedAt": null,
  "durationMs": null
}
```

#### `GET /api/runs/:id`

单个 Run 的完整信息。

#### `POST /api/runs/:id/stop`

停止正在运行的 Run。

行为：

1. 查 status，如果不是 `running` 返回 409
2. 通过进程内 EventBus 发布 `stop:{runId}` 信号；同进程的 pg-boss worker 把 `runId` 对应的 `AbortController.abort()`
3. 立即把 `runs.status` 改为 `stopped`（worker 收到信号后会清理资源）
4. 返回 `{ ok: true }`

#### `GET /api/runs/:id/events`

某个 Run 的历史事件（持久化日志）。

```
?level=info&page=1&pageSize=100
```

> 实时日志走 SSE，见下方 `/sse/runs/:id/logs`。

---

### Items

#### `GET /api/items`

抓取结果列表。

**参数：**

| 参数               | 类型                       | 说明                        |
| ------------------ | -------------------------- | --------------------------- |
| `spider`           | string                     | 过滤 spider                 |
| `runId`            | uuid                       | 限定某次 Run                |
| `type`             | string                     | 过滤 item.type              |
| `q`                | string                     | 搜索（url + payload.title） |
| `page`, `pageSize` | number                     | 分页                        |
| `sort`             | `-fetchedAt` / `fetchedAt` | 排序                        |

**返回每行：**

```json
{
  "id": 123,
  "spider": "nextjs-blog",
  "type": "post",
  "url": "https://nextjs.org/blog/turbopack-...",
  "fetchedAt": "...",
  "payload": { "title": "...", "description": "..." }
}
```

#### `GET /api/items/:id`

单条详情，返回完整 `payload`。

---

### Settings

#### `GET /api/settings/:key`

读取一个 setting key。返回 `{ key, value, updatedAt }`。

#### `PUT /api/settings/:key`

写一个 setting key。

**请求体：** `{ "value": <任意 JSON> }`

**示例：更新代理池**

```
PUT /api/settings/proxy_pool
Body: { "value": { "proxies": [
  { "url": "http://user:pass@host:8080", "failures": 0 }
] } }
```

校验逻辑根据 key 决定，按 key 分发的 Zod schema 由 settings 路由 (`src/app/api/settings/[key]/route.ts`) 自管。

---

### Stats（看板首页用）

#### `GET /api/stats/summary`

聚合数据，给 Dashboard 卡片用。

**返回：**

```json
{
  "ok": true,
  "data": {
    "running": 2,
    "queued": 1,
    "completed24h": 14,
    "failed24h": 1,
    "totalItems": 1234,
    "newItems24h": 89,
    "qpsLast5m": 12.4,
    "errorRateLast5m": 0.02
  }
}
```

---

## SSE 通道

### `GET /sse/runs/:id/logs`

订阅某个 Run 的实时事件流。

**响应头：**

```
Content-Type: text/event-stream
Cache-Control: no-cache, no-transform
Connection: keep-alive
```

**事件格式：**

进程内 pg-boss worker 把每个 `CrawlerEvent` 推到内存 EventBus，
SSE handler 订阅 `runId` 对应的 channel 并转发给浏览器：

```
event: log
data: {"level":"info","type":"fetched","message":"https://...","at":"2026-04-30T13:50:01Z"}

event: stats
data: {"fetched":42,"emitted":40,"errors":0}

event: done
data: {"status":"completed","stats":{...}}
```

事件类型：

| event   | 说明                                 |
| ------- | ------------------------------------ |
| `log`   | 任意日志事件                         |
| `stats` | 增量统计快照（每秒最多 1 次）        |
| `done`  | Run 终止（completed/failed/stopped） |

客户端处理：

```ts
const es = new EventSource(`/sse/runs/${id}/logs`);
es.addEventListener('log', (e) => append(JSON.parse(e.data)));
es.addEventListener('stats', (e) => updateStats(JSON.parse(e.data)));
es.addEventListener('done', () => es.close());
```

**断线重连：** 浏览器自动重连。Server 端要支持 `Last-Event-ID` 头，把缺失的事件回放给客户端（当前简化：不回放，只发新事件，客户端可在重连后重新拉一次 `/api/runs/:id/events`）。

---

## 校验 schema 共享

请求体 Zod schema 与 API 路由代码并置（在每个 `src/app/api/.../route.ts` 文件
顶部声明）。需要在前端复用时，可以从对应的 route 文件 re-export，或者集中放到
`src/lib/shared/`（目前共享的主要是 `CrawlerEvent` 联合类型）。

前端 `react-hook-form + zodResolver` 直接复用同一份 schema，省掉两边手抄。

---

## 速率限制

当前不做。如果后续暴露到公网，建议：

- API 路由用 `next-rate-limit` 或 Edge Middleware
- 同时给 SSE 端点加 IP 级别的并发上限（防 DDoS）
