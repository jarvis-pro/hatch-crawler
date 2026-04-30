# 数据模型

> 本文定义 hatch-crawler v1 的所有持久化数据结构。
> 数据库为 **Postgres 16**，ORM 为 **Drizzle**。

## ER 概览

```
┌─────────────┐         ┌─────────────┐
│   spiders   │         │  settings   │
│             │         │             │
│  name (PK)  │         │  key (PK)   │
│  config     │         │  value JSON │
└──────┬──────┘         └─────────────┘
       │
       │ 1:N
       ▼
┌─────────────┐ 1:N    ┌─────────────┐
│    runs     │───────►│   events    │
│             │        │             │
│  id (PK)    │        │  id (PK)    │
│  spider_fk  │        │  run_id_fk  │
│  status     │        │  level      │
│  started_at │        │  type       │
│  stats      │        │  payload    │
└──────┬──────┘        └─────────────┘
       │
       │ 1:N
       ▼
┌─────────────┐
│    items    │
│             │
│  id (PK)    │
│  run_id_fk  │
│  spider     │
│  url        │
│  payload    │
│  url_hash   │
│  content_hash│
└─────────────┘

       ┌─────────────┐
       │   visited   │   ← URL 指纹去重表（无外键，独立索引）
       │             │
       │  url_hash   │
       │  spider     │
       │  visited_at │
       └─────────────┘
```

## 表定义（Drizzle schema）

下面是各表的 Drizzle 描述，将放在 `packages/db/src/schema.ts`。

### spiders

注册的 Spider 定义。Worker 启动时根据这张表加载（也可以写代码硬编码，看板上把"用户可改的覆盖参数"存这里）。

```ts
export const spiders = pgTable("spiders", {
  name: varchar("name", { length: 64 }).primaryKey(), // "nextjs-blog"
  displayName: varchar("display_name", { length: 128 }).notNull(),
  description: text("description"),
  startUrls: jsonb("start_urls").$type<string[]>().notNull(),
  allowedHosts: jsonb("allowed_hosts").$type<string[]>().notNull().default([]),
  maxDepth: integer("max_depth").notNull().default(2),
  concurrency: integer("concurrency").notNull().default(4),
  perHostIntervalMs: integer("per_host_interval_ms").notNull().default(500),
  enabled: boolean("enabled").notNull().default(true),
  cronSchedule: varchar("cron_schedule", { length: 64 }), // null = 不自动调度
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

### runs

每次抓取的实例。包含状态和聚合统计。

```ts
export const runStatus = pgEnum("run_status", [
  "queued", // 已入队，等待 worker 拉取
  "running", // worker 已拉取，正在执行
  "completed", // 正常完成
  "failed", // 异常终止
  "stopped", // 用户主动停止
]);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spiderName: varchar("spider_name", { length: 64 })
      .notNull()
      .references(() => spiders.name, { onDelete: "cascade" }),
    status: runStatus("status").notNull().default("queued"),
    triggerType: varchar("trigger_type", { length: 16 }).notNull(), // "manual" | "cron"
    // 用户在前端可以临时覆盖 spider 默认配置
    overrides: jsonb("overrides").$type<Record<string, unknown>>().default({}),

    // 统计字段，worker 增量更新
    fetched: integer("fetched").notNull().default(0),
    emitted: integer("emitted").notNull().default(0),
    newItems: integer("new_items").notNull().default(0),
    errors: integer("errors").notNull().default(0),

    startedAt: timestamp("started_at"),
    finishedAt: timestamp("finished_at"),
    errorMessage: text("error_message"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byStatus: index("idx_runs_status").on(t.status),
    bySpider: index("idx_runs_spider").on(t.spiderName, t.createdAt),
  }),
);
```

### events

实时日志的持久化。每个事件一行。

```ts
export const eventLevel = pgEnum("event_level", [
  "debug",
  "info",
  "warn",
  "error",
]);

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    level: eventLevel("level").notNull(),
    // 事件类型枚举：fetched / emitted / parse_failed / queued / done / ...
    type: varchar("type", { length: 32 }).notNull(),
    message: text("message"),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  },
  (t) => ({
    byRun: index("idx_events_run_time").on(t.runId, t.occurredAt),
  }),
);
```

> **注意**：events 表会快速膨胀。生产环境应配 retention（每天清理 7 天前数据）。
> v1 简化处理：在 `apps/worker` 里只持久化 `info` 及以上级别，`debug` 不入库。

### items

抓取到的内容。结构基本继承 v0 的 SQLite items 表。

```ts
export const items = pgTable(
  "items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    spider: varchar("spider", { length: 64 }).notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    url: text("url").notNull(),
    urlHash: char("url_hash", { length: 40 }).notNull(), // sha1 hex
    contentHash: char("content_hash", { length: 40 }).notNull(),
    payload: jsonb("payload").notNull(),
    fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqContent: uniqueIndex("uniq_items_spider_url_content").on(
      t.spider,
      t.urlHash,
      t.contentHash,
    ),
    bySpiderType: index("idx_items_spider_type").on(t.spider, t.type),
    byFetchedAt: index("idx_items_fetched_at").on(t.fetchedAt),
    // 简单的全文搜索：基于 url + payload 的 GIN 索引（可选）
    // 用 trigram 索引也行；v1 先不上 FTS
  }),
);
```

### visited

URL 指纹去重表（独立于 runs，跨 Run 共享）。这样下次抓取同一 URL 会被跳过，实现增量。

```ts
export const visited = pgTable(
  "visited",
  {
    spider: varchar("spider", { length: 64 }).notNull(),
    urlHash: char("url_hash", { length: 40 }).notNull(),
    url: text("url").notNull(),
    visitedAt: timestamp("visited_at").notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.spider, t.urlHash] }),
  }),
);
```

> 用 `(spider, urlHash)` 复合主键。允许同一 URL 在不同 Spider 下被重新访问。

### settings

通用 KV，用来存放代理池、UA 池等不适合做结构化建模的配置。

```ts
export const settings = pgTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
```

约定的 key：

| key          | value 形态                                | 说明                      |
| ------------ | ----------------------------------------- | ------------------------- |
| `proxy_pool` | `{ proxies: ProxyEntry[] }`               | 代理列表 + 各自的失败计数 |
| `ua_pool`    | `{ user_agents: string[] }`               | UA 字符串列表             |
| `defaults`   | `{ concurrency, perHostIntervalMs, ... }` | 全局默认 Spider 参数      |

## 索引策略

| 索引                            | 表      | 用途                      |
| ------------------------------- | ------- | ------------------------- |
| `idx_runs_status`               | runs    | 看板首页"当前运行"列表    |
| `idx_runs_spider`               | runs    | Runs 页按 Spider 过滤     |
| `idx_events_run_time`           | events  | 历史日志倒序查询          |
| `uniq_items_spider_url_content` | items   | 去重保证                  |
| `idx_items_spider_type`         | items   | Items 页 Spider/Type 过滤 |
| `idx_items_fetched_at`          | items   | 最近抓取的 Items          |
| `(spider, urlHash) PK`          | visited | 增量去重 lookup           |

## 迁移策略

- 用 Drizzle Kit：`drizzle-kit generate` 自动生成 SQL
- 迁移文件存在 `packages/db/migrations/`
- 启动时自动跑：`apps/worker` 和 `apps/web` 启动入口都会调用 `migrate()`，但加分布式锁（用 `pg_advisory_lock`）避免并发执行

## 数据保留与清理

| 数据                    | 保留   | 清理方式                                |
| ----------------------- | ------ | --------------------------------------- |
| events.debug            | 不入库 | 直接过滤                                |
| events.info+            | 7 天   | 定时任务 + cron Spider                  |
| runs (completed/failed) | 30 天  | 同上                                    |
| items                   | 不删   | 用户手动清理                            |
| visited                 | 不删   | 用户手动清理（删 visited 即可强制重抓） |

清理任务在 v1 用一个内置 Spider `__housekeeping` 实现：每天 03:00 跑一次。

## 与 v0 的迁移

v0 的 `data/crawler.sqlite` → v1 Postgres：

- 表结构基本兼容，写一个 `scripts/migrate-from-sqlite.ts`：
  - 从 SQLite 读 `items` 表，逐行 insert 到 Postgres
  - 同样处理 `visited`
- v0 的 JSONL 文件不迁移（信息已经在 SQLite 里）

迁移脚本将放在 Phase 2 完成。
