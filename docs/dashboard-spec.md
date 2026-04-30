# 看板交互规范

> 描述每个页面的布局、组件、交互行为、用户旅程。
> Next.js 15 App Router，Tailwind + shadcn/ui，TanStack Query。

## 信息架构

```
/                       → 重定向到 /dashboard
/dashboard              → 概览（实时监控）
/spiders                → Spider 列表
/spiders/[name]         → Spider 详情 + 配置
/runs                   → 历史 Run 列表
/runs/[id]              → 单个 Run 详情（含实时日志）
/items                  → 抓取结果浏览/搜索
/items/[id]             → 单条 Item 详情
/settings               → 全局设置（代理池/UA 池/默认参数）
```

## 全局布局

```
┌──────────────────────────────────────────────────────────┐
│  Sidebar               │  Topbar                          │
│  ─────────             │  ─────────────────────────────── │
│  ▣ Dashboard           │  Page title         [⏵ New Run] │
│  ▢ Spiders             │  ─────────────────────────────── │
│  ▢ Runs                │                                  │
│  ▢ Items               │            Page content          │
│  ▢ Settings            │                                  │
│                        │                                  │
└────────────────────────┴──────────────────────────────────┘
```

- 左侧 64px 折叠 / 240px 展开 Sidebar
- 顶部 56px Topbar，主要放页面标题与"新建运行"按钮
- 右上角小按钮：连接状态指示（绿灯=Worker 在线、红灯=Redis 不可达）

## 页面规范

### 1. `/dashboard` — 概览

**目标：** 一眼看清"系统现在在干什么"。

```
┌─────────────────────────────────────────────────────────┐
│ [运行中] [排队] [今日完成] [今日失败] [总条目] [新增]   │
│   2       1       14         1         1234     89    │
└─────────────────────────────────────────────────────────┘

[当前运行]                                       [+ 新建运行]
┌──────────────────────────────────────────────────────────┐
│ ▶ nextjs-blog · run abc123 · 2m 14s                      │
│   [████████░░░░░░░] fetched 24/?? · 0 errors             │
│   [查看实时日志] [停止]                                   │
├──────────────────────────────────────────────────────────┤
│ ▶ housekeeping · run xyz789 · 12s                        │
│   ...                                                     │
└──────────────────────────────────────────────────────────┘

[最近完成]
┌──────────────────────────────────────────────────────────┐
│ ✓ nextjs-blog 12 min ago · 24 fetched · 22 new · 0 err   │
│ ✓ nextjs-blog 1 h ago    · 24 fetched · 0 new            │
│ ✗ vercel-docs 2 h ago    · timeout @ depth 2             │
└──────────────────────────────────────────────────────────┘
```

**数据源：**

- `GET /api/stats/summary`（5s 轮询）
- `GET /api/runs?status=running,queued`（5s 轮询）
- `GET /api/runs?status=completed,failed,stopped&pageSize=10`（10s 轮询）

**交互：**

- 点击"新建运行"打开 Modal，选择 Spider + 调参
- 点击运行行 → 跳 `/runs/[id]`
- "停止"按钮调 `POST /api/runs/[id]/stop`，乐观更新

---

### 2. `/spiders` — Spider 列表

```
┌────────────────────────────────────────────────────────┐
│ Search [_____________]              [+ 新建 Spider]    │
├──────────┬──────────────┬────────┬────────┬───────────┤
│ Name     │ Display      │ Cron   │ Last   │ Actions   │
├──────────┼──────────────┼────────┼────────┼───────────┤
│ nextjs-  │ Next.js 官博 │ —      │ 12 min │ [▶] [⋯]  │
│  blog    │              │        │ ago    │           │
└──────────┴──────────────┴────────┴────────┴───────────┘
```

每行右侧有"立即运行"按钮（一键 `POST /api/runs`）和下拉菜单（编辑、禁用、删除）。

---

### 3. `/spiders/[name]` — Spider 详情

两个 Tab：

**Tab 1: 配置**

- 表单：displayName, description, startUrls (可增删), allowedHosts, maxDepth, concurrency, perHostIntervalMs, cronSchedule
- 用 react-hook-form + zodResolver
- 顶部右侧"保存"按钮，禁用直到表单 dirty

**Tab 2: 历史 Runs**

- 嵌入式 Run 列表，自动按当前 spider 过滤

---

### 4. `/runs` — Run 列表

```
[Spider: All ▼]  [Status: All ▼]  [日期范围]      [搜索]

┌─────────────────────────────────────────────────────────┐
│ ✓ abc123  nextjs-blog  completed  24/24/22  12 min ago  │
│ ▶ def456  nextjs-blog  running    18/18/16  now         │
│ ✗ ghi789  vercel-docs  failed     5/3/3     1 h ago     │
└─────────────────────────────────────────────────────────┘
```

每行可点击进入详情。状态用图标 + 颜色区分：

- ⏳ queued — 灰
- ▶ running — 蓝（带跑马灯动画）
- ✓ completed — 绿
- ✗ failed — 红
- ⏹ stopped — 橙

---

### 5. `/runs/[id]` — Run 详情（核心页）

```
┌─────────────────────────────────────────────────────────┐
│ ⏵ Run abc123 · nextjs-blog · running · 2m 14s           │
│ [停止] [复制 ID] [新建相同 Run]                          │
├─────────────────────────────────────────────────────────┤
│ Stats                                                    │
│ ┌────────┬────────┬────────┬────────┐                   │
│ │ Fetch  │ Emit   │ New    │ Errors │                   │
│ │  24    │  24    │  22    │   0    │                   │
│ └────────┴────────┴────────┴────────┘                   │
├─────────────────────────────────────────────────────────┤
│ Live Logs                          [Pause] [Clear filter]│
│ ┌─────────────────────────────────────────────────────┐ │
│ │ 13:50:01 INFO  fetched https://nextjs.org/blog      │ │
│ │ 13:50:01 INFO  parsed page (24 links, 22 followed)  │ │
│ │ 13:50:02 INFO  fetched https://nextjs.org/blog/...  │ │
│ │ 13:50:02 INFO  emitted item: "Turbopack..."         │ │
│ │ ▌ (auto-scroll)                                     │ │
│ └─────────────────────────────────────────────────────┘ │
│ Filter: [○ Debug ○ Info ◉ Warn ○ Error]                 │
└─────────────────────────────────────────────────────────┘
```

**实时日志：** 通过 `/sse/runs/[id]/logs` 订阅。

**控件：**

- "Pause" 暂停自动滚动（重新出现新日志时变回"Resume + N"按钮）
- "Filter" 客户端按 level 过滤
- 顶部"复制 ID"快捷
- "新建相同 Run" → 跳到 `/runs/new?from=<id>`，预填同样的 spider + overrides

**完成后：** 收到 `done` 事件，关闭 SSE，按钮区切换到只读"查看抓取结果 →"链接到 `/items?runId=<id>`。

---

### 6. `/items` — 抓取结果

最重要的"使用方"页面。

```
┌─────────────────────────────────────────────────────────┐
│ Spider: [All ▼]  Type: [All ▼]  q: [_____________] [⌕] │
└─────────────────────────────────────────────────────────┘

┌────┬────────┬──────┬─────────────────────┬──────────┐
│ #  │ Spider │ Type │ Title (from payload)│ Fetched  │
├────┼────────┼──────┼─────────────────────┼──────────┤
│ 12 │ nextjs │ post │ Turbopack 1.0       │ 12m ago  │
│ 11 │ nextjs │ post │ Next.js 15 stable…  │ 13m ago  │
└────┴────────┴──────┴─────────────────────┴──────────┘

[Load more] / 分页器
```

每行点击展开 inline drawer，显示 payload JSON tree（用 react-json-view 类组件）。
顶部有 "Export JSON Lines" 按钮，下载当前过滤集合。

---

### 7. `/items/[id]` — Item 详情

整页：URL、抓取时间、所属 Run（链接）、payload 完整 JSON，支持复制全部。

---

### 8. `/settings` — 设置

三个 Tab：

**Tab 1: 代理池**

- 列表展示当前所有代理：`url / failures / lastUsed / status (active / disabled)`
- 顶部"添加"打开 Modal：URL、可选用户名密码
- 每行可"测试"（向测试 endpoint 发请求看是否通）和"删除"

**Tab 2: User-Agent 池**

- 文本框（每行一个 UA）
- 顶部按钮"重置为默认"

**Tab 3: 默认参数**

- 全局 `concurrency / perHostIntervalMs / requestTimeoutMs / retryAttempts` 默认值
- 影响新建 Run 时表单的初值（不会改 Spider 已有配置）

---

## 共享组件清单

| 组件               | 用途                                             |
| ------------------ | ------------------------------------------------ |
| `<RunStatusBadge>` | queued/running/completed/failed/stopped 状态徽章 |
| `<StatsCard>`      | dashboard 顶部统计卡片                           |
| `<RunRow>`         | runs 列表的一行（多页复用）                      |
| `<LiveLogStream>`  | SSE 接入的实时日志面板                           |
| `<JsonViewer>`     | item payload 的 JSON 树展示                      |
| `<PaginatedTable>` | 通用分页表格（runs / items）                     |
| `<NewRunDialog>`   | 新建 Run 的 Modal                                |
| `<EmptyState>`     | 空状态占位                                       |

## 用户旅程

### 第一次使用

1. 打开 `/dashboard`，空空如也，提示"还没有任何 Spider，先去 [Spiders](/spiders) 创建一个"
2. 点链接进 `/spiders`，看到示例 Spider `nextjs-blog`，点"立即运行"
3. 自动跳到 `/runs/[id]`，看实时日志滚动
4. 完成后点"查看抓取结果"进 `/items?runId=<id>`，浏览数据
5. 回到 `/dashboard` 看统计卡片有数据了

### 日常运营

1. 打开 `/dashboard` 看是否有"运行中"或"今日失败"
2. 有失败 → 点进 `/runs/[id]` 看错误日志
3. 没问题 → 点 `+ 新建运行` 触发一次新抓取，或者去 `/spiders/[name]` 配 cron 让它自动跑

### 出现反爬

1. `/runs/[id]` 看到大量 `errors`，日志里都是 403
2. 跳 `/settings` Tab 1，添加几个代理
3. 回 `/runs` 重新触发，错误率应该下降

## 设计原则

- **状态先行**：每个页面顶部都用最显眼的方式展示当前状态（颜色 + 数字）
- **渐进披露**：列表页不展开 payload，需要详情时点击
- **无意外**：危险操作（删除 Spider、清空 visited）必须二次确认
- **实时优先**：能 SSE 就 SSE，能 5s 轮询就 5s，能不轮询就不轮询
- **空状态友好**：每个列表都有引导式空状态（不是冷冰冰的"暂无数据"）
