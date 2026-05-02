# RFC 0003 — 任务模型重构与体验改造

| 状态     | **Implemented** (2026-05-02)                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 作者     | hatch-crawler core                                                                                                                                                                                           |
| 创建于   | 2026-05-02                                                                                                                                                                                                   |
| 影响范围 | 看板信息架构大改 / runs 视图重做 / spiders 表加列 / 部分 API 简化；引擎层、accounts、kinds、平台 spider 不动                                                                                                 |
| 关联     | [`../getting-started/architecture.md`](../getting-started/architecture.md) · [`../reference/dashboard-spec.md`](../reference/dashboard-spec.md) · [`../reference/data-model.md`](../reference/data-model.md) |

---

## 1. 背景与目标

### 现状问题

当前的 Spider / Run 模型是面向引擎开发者的抽象——把所有抓取行为揉进同一个"配置 + 启动"模型里。但用户脑子里其实有三种心智完全不同的事，被强行压扁后产生了一系列体验破碎：

| 用户心智 | 触发方式           | 期望                                     | 现状                                                     |
| -------- | ------------------ | ---------------------------------------- | -------------------------------------------------------- |
| **订阅** | cron 持续跑        | 累计趋势 + 新增提醒 + 失败告警；不再操心 | 与一次性任务混列、cron 配置散落                          |
| **批量** | 一次手动触发，长跑 | 进度条 + 断点续传 + 跑完归档             | 与订阅同视图，看不到进度                                 |
| **快取** | 粘 URL 立即跑      | URL ↔ 结果一一对应，秒级反馈，跑完即弃   | 强行套 Spider 模型，列在 /spiders 里、有 cron 字段无意义 |

具体痛点（用户主诉 + 复盘补充）：

- **`/spiders` 列表混乱**：url-extractor 平台列空、cron 字段无意义但仍出现在配置面板
- **`/runs/:id` 体验破碎**：一键下载附件按钮废弃、LiveLogStream 永远卡在"等待事件…"、"查看抓取结果"按钮跳转后筛选丢失
- **`/items` 无来源区分**：看不出是订阅自动滚的、批量抓的、还是用户上周粘的链接
- **API 是冗余设计**：按"对外契约"组织，但项目从未对外开放
- **抽象错位带来的连锁问题**：spiders.id 是 UUID 但路由参数叫 `[name]`、`runs.spider_name` 字段名让人误以为冗余的是 type、display_name / spider_type 等历史遗留列还在

### 目标

在不推翻引擎、不重写底层数据存储的前提下，把"用户操作体验"做到下面三条：

1. **每一类任务都有专属视图**：订阅看趋势、批量看进度、快取看 URL 对照
2. **数据全链路可追溯**：每条 item 都能回答"是谁抓的、什么时候、什么任务"
3. **错误自愈路径短**：凭据失效、spider 停用、proxy 失败都有 1-click 修复入口

### 非目标

- 不重写引擎（`src/lib/crawler`）
- 不动 accounts 加密、kinds Zod、平台 spider 实现
- 不引入新依赖
- 不切换队列实现（仍是 pg-boss）
- 不做认证（仍单用户本地）

---

## 2. 新心智模型：Task 三分

引入 **Task** 作为对用户暴露的最高层概念，背后仍由 spider-registry 驱动，但 "Spider" 这个词在 UI 里彻底消失：

```
Task
├─ Subscription（订阅）  ← cron 长期跑；失败要告警；ban 要触发
├─ Batch（批量）        ← 一次性大量跑；要进度；可中断
└─ Extract（快取）      ← 粘链接立即抓；秒级反馈；不计失败
```

**实现方式**：不新增 `tasks` 表，给 `spiders` 表加 `task_kind` 列做派生标记即可（详见 §4）。引擎层完全不知道 `task_kind` 的存在，依然通过 `spider.type` 反查注册表实现类。

---

## 3. 信息架构改造

### 新路由表

```
/                       → 重定向到 /dashboard
/dashboard              → 概览（按任务类型分组的统计卡）
/extract                → 快取：粘贴框 + URL↔结果表（默认入口候选）
/subscriptions          → 订阅列表
/subscriptions/:id      → 订阅详情（趋势 + 最近运行 + 数据预览 + 配置 一页搞定）
/batches                → 批量任务列表
/batches/:id            → 批量详情（进度 + 错误聚合）
/data                   → 数据浏览（原 /items，加来源 chip）
/data/:id               → 单条详情（含来源任务回链）
/credentials            → 凭据管理（从 settings 提到一级页）
/settings               → 全局设置（代理 / UA / 通知 / 默认参数 / 系统依赖）
/dev                    → 开发者后门（可选）：/dev/spiders + /dev/runs（保留原页）
```

### 关键变化

- 主导航 `/spiders` 与 `/runs` 退出顶级，作为开发者调试入口可保留在 `/dev/*`
- 凭据管理从 settings 子 tab 提升为一级页面（用户访问频率高）
- `/extract` 是"粘贴 + 立刻跑 + 立刻看结果"的一体页面，不再两步走

---

## 4. 数据模型增量

选择 **复用现有 spiders 表 + 加列** 而非新建 tasks 表，理由：迁移成本最小、引擎层完全不感知。

### 4.1 `spiders` 加列

```sql
ALTER TABLE spiders ADD COLUMN IF NOT EXISTS task_kind varchar(16);

-- 回填规则：
UPDATE spiders SET task_kind = 'extract'      WHERE type = 'url-extractor';
UPDATE spiders SET task_kind = 'subscription' WHERE cron_schedule IS NOT NULL AND task_kind IS NULL;
UPDATE spiders SET task_kind = 'batch'        WHERE task_kind IS NULL;

ALTER TABLE spiders ALTER COLUMN task_kind SET NOT NULL;
```

后续创建 spider 时由表单决定 task_kind；引擎不读这一列。

### 4.2 `runs` 加列

```sql
ALTER TABLE runs ADD COLUMN IF NOT EXISTS task_kind varchar(16);
-- worker 写 run 时从 spider 同步过来；查询时不再 JOIN
```

### 4.3 `items` 加列

```sql
ALTER TABLE items ADD COLUMN IF NOT EXISTS trigger_kind varchar(16);
-- worker 写 item 时从 run 同步；用于 /data 的来源 chip 过滤
ALTER TABLE items ADD COLUMN IF NOT EXISTS task_id uuid;
-- 直接挂 spiders.id（任务 id）；展示来源链接用，不强制 FK
CREATE INDEX IF NOT EXISTS idx_items_trigger_kind ON items (trigger_kind);
```

### 4.4 历史遗留清理（阶段二）

```sql
ALTER TABLE spiders DROP COLUMN display_name;
ALTER TABLE spiders DROP COLUMN spider_type;
ALTER TABLE runs RENAME COLUMN spider_name TO spider_label;
```

---

## 5. 阶段一：关键 bug 修补 + UI 重构（目标 1–2 周）

### 5.1 关键 bug & 安全修复（先做掉，避免后续视图基于坏轮子）

- [x] 删除 `/runs/[id]` 的"一键下载附件"按钮 + 相关 mutation
- [x] `/runs/[id]` "查看抓取结果"按钮改为 `/data?runId=:id`，不再丢筛选
- [x] 修复 LiveLogStream 卡在"等待事件…"（`connecting → streaming → done` 状态机）
- [x] `/api/items/:id/download` SSRF 修复：从 `item.payload.url / media[].url` 取候选集，不命中 → 400
- [x] cron 重入保护：`crawl-cron:<spiderId>` worker 触发时先查 `runs(spider_id, status='running')`，命中则跳过本次

### 5.2 任务模型上线（数据层）

- [x] `spiders.task_kind` 加列 + 回填 + NOT NULL（migrate.ts + schema.prisma 同步）
- [x] `runs.task_kind` 加列 + worker 同步写入
- [x] `items.trigger_kind` + `items.task_id` 加列 + worker 同步写入
- [x] `src/lib/db/index.ts` 同步收紧业务类型：`Spider.taskKind` / `Run.taskKind` / `Item.triggerKind`

### 5.3 新增页面

- [x] `/extract` 页：单页粘贴框 + 提交后展示 URL↔结果对照表（每行 spinner→✓/✗ + 抓到的标题缩略）
- [x] `/subscriptions` 列表：名称 · 平台 · cron 调度 · 状态
- [x] `/subscriptions/:id` 详情单页：近 14 天折线图 + 最近 5 次 run 摘要 + 最近 10 条 item 预览
- [x] `/batches` 列表：名称 · 平台 · 最近运行
- [x] `/batches/:id` 详情：最近 run 摘要卡 + 错误事件聚合 + Stop/Run 按钮
- [x] 侧边栏重排：[仪表盘 / 快取 / 订阅 / 批量 / 数据 / 凭据 / 设置 / Dev]
- [x] `/spiders` `/runs` 从主导航移除；保留 `/dev/spiders` `/dev/runs` 作开发者后门
- [x] `/` 默认重定向至 `/extract`

### 5.4 视图差异化

- [x] **extract 视图**：URL→结果表 + SSE 状态（connecting/streaming/done）
- [x] **batch 视图**：错误明细聚合（按 error message 分组计数 + 降序）
- [x] LiveLogStream `connecting → streaming → done` 状态机，done 时显示"── 任务结束 ──"

### 5.5 数据浏览改进

- [x] `/data` 顶部加来源 chip：全部 / 订阅（CalendarClock）/ 批量（Layers）/ 快取（Link2）
- [x] `/data/:id` 单条详情加"来源任务"行，可点跳回 `/subscriptions/:id` 或 `/batches/:id`

### 5.6 注册表元数据增强

- [x] `SpiderEntry` 接口加 `paramSchema: z.ZodType` + `description: string`
- [x] 14 个现有 spider 全部补 paramSchema + description
- [x] `/api/spiders/registry` 序列化返回（`zod-to-json-schema` 可选安装，缺包时走手动回退）

### 5.7 阶段一交付验收

- [x] 进入 `/extract` 粘 YouTube URL，SSE 实时展示 URL↔结果对照
- [x] `/subscriptions/:id` 展示折线图 + 最近运行 + 数据预览
- [x] `/data` 能用 chip 切换来源类型
- [x] 所有 5.1 的关键 bug 消失

---

## 6. 阶段二：数据层正名 + 安全/正确性收尾（2–3 周）

### 6.1 历史遗留清理

- [x] drop `spiders.display_name` 列（migrate.ts，幂等 DO 块保护）
- [x] drop `spiders.spider_type` 列
- [ ] rename `runs.spider_name` → `runs.spider_label`（待下一次 breaking change 窗口）
- [ ] 路由 `/spiders/[name]` 重命名为 `/spiders/[id]`（干脆移到 `/dev/spiders/[id]` 即可）

### 6.2 阈值与配置集中化

- [x] `max_consecutive_failures` 从 settings 读（job-handler.ts）
- [x] `stale_run_timeout_min` 从 settings 读（worker/index.ts，默认 30）
- [x] `events_retention_days` 从 settings 读（daily cron）
- [ ] settings 子页用 zod schema 渲染，每个字段有默认值 + 校验（待 UI 迭代）

### 6.3 运维能力补全

- [x] events 表按 `events_retention_days`（默认 30）daily cron 清理（每日 02:00）
- [x] webhook 改造：`X-Webhook-Signature` HMAC-SHA256 + 失败重试 3 次（指数退避）+ 落 `webhook_deliveries` 表
- [ ] webhook 事件类型扩展：`spider_auto_disabled`、`account_banned`（已有 `run_finished` + `auto_disabled`）
- [ ] proxy 池健康度自动剔除
- [ ] 凭据测试每平台都做：bilibili `nav` / xhs home / weibo `friends/timeline` / douyin user info

### 6.4 schema 双源治理（任选其一）

- [ ] 方案 A：CI 加一步 `prisma migrate diff` 对比 migrate.ts 结果，diff 不为空就 fail
- [ ] 方案 B：切换到 `prisma migrate deploy`，把 migrate.ts 改成只调它一次（彻底解决双源）

### 6.5 错误码语义统一

- [ ] 全仓搜 `fail('NOT_FOUND'` 中传非数字 id 的，改成 `VALIDATION_ERROR`
- [ ] 抽 `parseId(s, 'item' | 'run' | 'spider')` helper 统一处理

### 6.6 阶段二交付验收

- [ ] schema 双源不再需要靠文档提醒同步——CI 或工具自动校验
- [ ] webhook 接收方能用 HMAC 验证消息真伪
- [ ] 5 个平台的凭据测试都能给出真实的 valid/invalid 反馈，不再"假成功"
- [ ] events 表行数不会单调增长

---

## 7. 阶段三：体验细节打磨（持续，按价值排）

- [ ] 全局粘贴检测：在任何页面 Cmd+V 含 URL 文本时，floating toast "检测到 N 条 YouTube 链接，去快取吗？"
- [ ] 凭据失败的 toast 即时提示 + 解禁深链：worker 把 account 标 banned 时通过 EventBus 推到看板，全局 toast"YouTube apikey #2 已停用 [去解禁]"
- [ ] spider 自动停用 toast 加"为什么"按钮 → 直接打开最近 failed run 的事件流
- [ ] 批量删除返回 `{ deleted, skipped: { id, reason }[] }`，前端 toast 显示"已删除 X 条，跳过 Y 条 running"
- [ ] 订阅详情"上次成功 2h 前 / 上次失败原因 / 7 天累计 12 条"per-card metrics
- [ ] storage 接口收敛：把 file / SQLite 移到 `archive/`，主线只保留 内存 + Postgres
- [ ] SSE 历史回放简化：缓冲容量加上限（500 条）；或迁到 `pg_notify / LISTEN`
- [ ] API 收敛到 server actions：内部消费的 REST 端点逐步改成 RPC 风格，省掉序列化层

---

## 8. 风险与回滚

| 风险                                              | 影响                       | 应对                                                                                       |
| ------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| `task_kind` 回填规则误判（cron 空但不该是 batch） | 旧任务被错误归类           | 回填脚本可重跑；用户可在新建任务时显式指定                                                 |
| 路由 `/spiders/[name]` 重命名导致旧链接失效       | 用户书签 / 浏览器历史失效  | 加 redirect：`/spiders/:id` → `/subscriptions/:id` 或 `/batches/:id` 或 `/dev/spiders/:id` |
| paramSchema 与现有 spider 实现的字段对不上        | 新表单提交后 spider 缺参数 | 阶段一不强制 paramSchema 完备；缺失时回退到 jsonb 编辑器                                   |
| LiveLogStream 修不通（更深层时序问题）            | "等待事件…" 仍然卡住       | 已有"原始日志"是 fallback；视图差异化后首屏即使无 raw 日志也可用                           |

每个阶段独立可验收，可以随时停在任一阶段——不存在"做到一半状态不一致"。

---

## 9. 实施备注

- **不推翻重来**：引擎、accounts 加密、kinds Zod、平台 spider 实现都不动；改动主要在 UI 层 + 少量数据列
- **顺序约束**：5.1 关键 bug → 5.2 数据层 → 5.3-5.6 UI 重构 → 阶段二、三按价值排
- **跨阶段并行**：阶段三的细节项可以在阶段一/二的间歇穿插做，没有强依赖
- **MVP 验证点**：阶段一的 5.3 `/extract` 页是最小可验证单元，做完它（< 2 天）就能直观看出"按任务类型分视图"的体验差异是否值得继续推下去

---

## 10. 进展跟踪

> 本节是这份 RFC 的生命线：每完成一项就 check 一下，便于随时回看进度。
>
> 当前阶段：**阶段一未启动**

### 总览

- [ ] 阶段一全部完成
- [ ] 阶段二全部完成
- [ ] 阶段三常规化推进

### 关键里程碑

- [ ] 5.1 全部修完（解锁阶段一其他工作的前提）
- [ ] `/extract` 上线（MVP 验证点）
- [ ] `/subscriptions/:id` 单页详情上线（订阅类用户的核心入口）
- [ ] 6.4 schema 双源治理完成（架构债务清理）
