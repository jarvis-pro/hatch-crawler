# 看板规格

> 描述每个页面的布局、组件、交互行为、用户旅程。
> Next.js 15 App Router，Tailwind + shadcn/ui，TanStack Query。
>
> 页面源码：`src/app/<route>/page.tsx`；
> 组件源码：`src/components/{ui,nav,runs,items,stats}/`。

## 信息架构

```
/                       → 重定向到 /dashboard
/dashboard              → 概览（统计 + 趋势 + breakdown + 最近 Run）
/spiders                → Spider 列表
/spiders/[id]           → Spider 详情 + 配置（[name] 路由实际承载 spiders.id UUID）
/runs                   → 历史 Run 列表
/runs/[id]              → 单个 Run 详情（含实时日志）
/items                  → 抓取结果浏览 / 搜索 / 平台与 kind 筛选
/items/[id]             → 单条 Item 详情（视频含下载菜单）
/settings               → 全局设置（凭据 / 代理 / 通知 / 下载 / UA / 默认参数）
```

## 全局布局

```
┌──────────────────────────────────────────────────────────┐
│  Sidebar               │  Topbar                          │
│  ─────────             │  ─────────────────────────────── │
│  ▣ 仪表盘              │  Page title         [+ 新建运行] │
│  ▢ 爬虫                │  ─────────────────────────────── │
│  ▢ 任务                │                                  │
│  ▢ 数据                │            Page content          │
│  ▢ 设置                │                                  │
└────────────────────────┴──────────────────────────────────┘
```

- 左侧 240px Sidebar（`src/components/nav/sidebar.tsx`）
- 顶部 Topbar（`src/components/nav/topbar.tsx`）+ Theme Toggle
- 顶部 banner（条件出现）：`/api/system/health` 检测到 ffmpeg / yt-dlp 缺失时提示安装

## 页面规格

### 1. `/dashboard` — 仪表盘

**目标**：一眼看清"系统现在在干什么 + 历史增长趋势"。

布局（自上而下）：

```
统计卡片（StatsCard 组件）
┌─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
│ 运行中  │ 排队    │ 24h 完成│ 24h 失败│ 总条目  │ 24h 新增│
│   2     │   1     │   14    │   1     │  1234   │   89    │
└─────────┴─────────┴─────────┴─────────┴─────────┴─────────┘

新增趋势（GET /api/stats/trend?days=7）
┌──────────────────────────────────────────────────────────┐
│ 折线 / 条形：最近 7 天每日新 item                        │
└──────────────────────────────────────────────────────────┘

平台 / Kind Breakdown（GET /api/stats/breakdown）
┌──────────────────────┬───────────────────────────────────┐
│ byPlatform           │ byKind                            │
│ youtube  ████ 1234   │ video    ████ 5678                │
│ bilibili ██   456    │ post     ███  1234                │
│ ...                  │ ...                               │
└──────────────────────┴───────────────────────────────────┘

最近 Run（GET /api/runs?pageSize=5）
┌──────────────────────────────────────────────────────────┐
│ run id · spider name · 状态 · 用时 · 统计                │
│ [查看] [停止]                                             │
└──────────────────────────────────────────────────────────┘
```

数据：

- `GET /api/stats/summary`（5s 轮询）
- `GET /api/stats/trend?days=7`（30s 轮询）
- `GET /api/stats/breakdown`（30s 轮询）
- `GET /api/runs?status=running,queued&pageSize=10` + `GET /api/runs?pageSize=5`（5s）

操作：

- Topbar `[+ 新建运行]`：弹出 `<NewRunDialog>`（选 spider / 修改 overrides / 启动）

---

### 2. `/spiders` — Spider 列表

```
Topbar：             [+ 新建 Spider]   [+ 按链接抓取]
搜索 / 状态过滤
┌──────────────────────────────────────────────────────────┐
│ Name                Type            Platform  Cron  状态 │
├──────────────────────────────────────────────────────────┤
│ YouTube 健身 · 搜索   youtube-search  youtube  —    ●   │
│ B 站 UP 主 · ...      bilibili-...    bilibili —    ●   │
│ URL 提取器（内置）    url-extractor   —        —    ●   │
└──────────────────────────────────────────────────────────┘
```

数据：`GET /api/spiders`（10s 轮询）。

操作：

- 行点击 → `/spiders/:id`
- `[+ 新建 Spider]`：弹出对话框，先选 type（来自 `GET /api/spiders/registry`），填 name / cron / defaultParams / startUrls 等 → `POST /api/spiders`
- `[+ 按链接抓取]`：弹出对话框，textarea 粘贴 URL（每行一条，1..50） → `POST /api/extract`，成功跳转 `/runs/:runId`
- 行右键/末列：启用/禁用、克隆、删除（带 confirm）

---

### 3. `/spiders/[id]` — Spider 详情

布局：

- Header：name + type + platform badge + enable toggle
- 配置卡：startUrls / allowedHosts / maxDepth / concurrency / perHostIntervalMs / cronSchedule / defaultParams（jsonb 编辑器）
- 操作：保存（`PUT /api/spiders/:id`）、立即运行（`POST /api/runs`）、导出 JSON、删除
- 最近 5 条 Run 摘要 + 最近 5 条 Item 抽样

数据：`GET /api/spiders/:id`、`GET /api/runs?spiderId=:id&pageSize=5`、`GET /api/items?spider=<name>&pageSize=5`。

---

### 4. `/runs` — 任务列表

```
顶部过滤：spider 下拉、status chip（all / running / queued / completed / failed / stopped）
┌──────────────────────────────────────────────────────────┐
│ □ run id · spider · 状态 · 触发 · 创建时间 · 用时 · stats │
└──────────────────────────────────────────────────────────┘

底部操作条（选中后）：
[批量删除]
```

数据：`GET /api/runs`（spiderId / status / page）。
对终态行支持复选；`DELETE /api/runs { ids }` 自动跳过 running/queued。

---

### 5. `/runs/[id]` — Run 详情

```
Header：状态徽章 · spider · 触发类型 · 用时 · 创建时间
统计卡：fetched / emitted / newItems / errors（StatsCard）

[实时日志 LiveLogStream 组件]
事件按 level 高亮：debug 灰、info 默认、warn 黄、error 红

操作：
- running：[停止]
- 终态：  [查看 events] / [查看本次 items]
```

数据：

- `GET /api/runs/:id`（running/queued 时 2s 轮询，其他终态停止）
- SSE `GET /sse/runs/:id/logs` —— ready / log / done 三种事件
- 终态时合成 `done` 立即关闭

`<LiveLogStream>`（`src/components/runs/live-log-stream.tsx`）行为：

- 自动滚到底；用户上滑后暂停自动滚，回底再恢复
- `event === 'done'` → 关 EventSource、刷新 run 详情
- 历史事件先于 live 渲染，时间戳去重

---

### 6. `/items` — 数据列表

```
顶部过滤：q（标题/payload 模糊）、spider、type、platform、kind、runId
┌──────────────────────────────────────────────────────────┐
│ □ thumb · title · platform · kind · spider · fetched_at  │
└──────────────────────────────────────────────────────────┘

底部操作条（选中后）：
[批量删除]
```

数据：`GET /api/items`（10s 轮询）。
平台 / kind 列以彩色 badge 展示（youtube=红 / bilibili=蓝 / xhs=玫红 等）。

---

### 7. `/items/[id]` — Item 详情

不同 kind 渲染不同布局，但骨架统一：

```
Header：title · platform · kind · spider · run · fetched_at

左：渲染区（kind=video 时显示封面 + 元数据 + 数字单位"万/亿"自动）
   - 标题 / 作者 / 发布时间 / 时长 / 标签
   - 指标：views / likes / comments / shares
   - 描述（折叠展开）

右：操作面板
   - [打开原始 URL]
   - kind=video：
       [下载 ▾] DropdownMenu
       ├ 视频 · 最佳画质（http 直链）
       ├ 视频 · 1080 / 720 / 480 / 360p（yt-dlp）
       ├ 仅音频 mp3（yt-dlp）
       └ — 分隔
       └ [获取格式]：调 POST /api/items/:id/formats，写回 payload.videoFormats，刷新菜单
   - JSON 视图：JsonViewer 组件展示 payload

底：相关 items（同 sourceId / 同 author，可选）
```

数据：

- `GET /api/items/:id`
- 下载：`GET /api/items/:id/download?url=&fetcher=&audioOnly=&quality=` —— 浏览器原生下载
- 获取格式：`POST /api/items/:id/formats`

数字格式化：≥ 1 亿显示 "x.x 亿"，≥ 1 万显示 "x.x 万"，否则原值。

---

### 8. `/settings` — 设置

`<Tabs>`，6 个 tab：

| tab          | 内容                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| **凭据管理** | accounts CRUD：列表 / 新增 / 测试 / 解禁 / 删除（详见下方）                                               |
| **代理池**   | 编辑 `settings.proxy_pool`（一行一个 URL）；保存 = `PUT /api/settings/proxy_pool`                         |
| **通知**     | 编辑 `webhook_url`，[发送测试] = `POST /api/settings/webhook_test`                                        |
| **下载**     | `GET /api/system/health` 显示 ffmpeg / yt-dlp 状态 + 安装指引                                             |
| **UA 池**    | 编辑 `ua_pool.user_agents`（一行一个）                                                                    |
| **默认参数** | 编辑 `settings.defaults`（concurrency / perHostIntervalMs / requestTimeoutMs / retryAttempts / logLevel） |

#### 凭据管理子页

```
顶部：[+ 添加凭据]   平台筛选下拉
┌──────────────────────────────────────────────────────────────────┐
│ 平台 · label · kind · 状态 · last used · failureCount · quota    │
│ [测试] [解禁] [删除]                                              │
└──────────────────────────────────────────────────────────────────┘
```

- 添加：`POST /api/accounts` —— platform / label / kind / payload / 可选 expiresAt
- 测试：`POST /api/accounts/:id/test` → toast 显示 valid + message
- 解禁：`PATCH /api/accounts/:id { action: 'unban' }` → 刷新（仅 banned 行可见）
- 删除：`DELETE /api/accounts/:id`（confirm）
- 状态徽章：active 绿 / banned 红 / expired 灰 / disabled 灰

> payload 输入框使用密码型（不显示），列表展示永远不回显原文。

---

## 通用 UI 约定

- 颜色：tailwind 默认 + shadcn 主题；platform / kind / status 用一致的色板（见 `items/[id]/page.tsx` 顶部 BADGE map）
- 状态徽章 `<RunStatusBadge>`：queued 蓝 / running 紫 / completed 绿 / failed 红 / stopped 灰
- 错误提示：`sonner` toast；表单字段错误 inline
- 加载：骨架屏 / spinner；TanStack Query `isPending`
- 空状态：固定居中提示 + 主操作按钮
- 危险操作：`<ConfirmDialog>`（删除 / 批量删除）

## 用户旅程：典型四条

1. **手动单跑**：spiders 列表 → 行 [立即运行] / 顶部 [+ 新建运行] → 选 spider + overrides → 跳 `/runs/:id` 看 SSE 日志 → 完成后跳 `/items?runId=:id`
2. **按链接抓**：`/spiders` 顶部 [+ 按链接抓取] → 粘贴 URL → 跳 `/runs/:runId` → 完成后看结果
3. **配 cron**：`/spiders/:id` 设 cronSchedule（如 `0 */6 * * *`）保存 → 自动到点跑 → `/runs?spiderId=:id` 看历史
4. **凭据失效自愈**：worker 跑完 run 失败 → `accounts.failure_count` 累加 → 阈值后 `banned` → 看板 settings 解禁或新增 + 测试 → 再跑
