/**
 * Drizzle schema 定义。
 *
 * 与 docs/data-model.md 一一对应。修改前先读那份文档。
 *
 * 命名约定：
 *   - 列名用 snake_case（drizzle 配置里 casing 已开）
 *   - 索引名用 idx_<table>_<cols>，唯一索引用 uniq_<...>
 */

import {
  bigserial,
  boolean,
  char,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ──────────────────────────────────────────────────────────
// 枚举
// ──────────────────────────────────────────────────────────

export const runStatus = pgEnum("run_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "stopped",
]);

export const eventLevel = pgEnum("event_level", [
  "debug",
  "info",
  "warn",
  "error",
]);

// ──────────────────────────────────────────────────────────
// spiders —— 注册的 Spider 定义
// ──────────────────────────────────────────────────────────

export const spiders = pgTable("spiders", {
  name: varchar("name", { length: 64 }).primaryKey(),
  displayName: varchar("display_name", { length: 128 }).notNull(),
  description: text("description"),
  startUrls: jsonb("start_urls").$type<string[]>().notNull(),
  allowedHosts: jsonb("allowed_hosts").$type<string[]>().notNull().default([]),
  maxDepth: integer("max_depth").notNull().default(2),
  concurrency: integer("concurrency").notNull().default(4),
  perHostIntervalMs: integer("per_host_interval_ms").notNull().default(500),
  enabled: boolean("enabled").notNull().default(true),
  cronSchedule: varchar("cron_schedule", { length: 64 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────
// runs —— 每次抓取实例
// ──────────────────────────────────────────────────────────

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spiderName: varchar("spider_name", { length: 64 })
      .notNull()
      .references(() => spiders.name, { onDelete: "cascade" }),
    status: runStatus("status").notNull().default("queued"),
    triggerType: varchar("trigger_type", { length: 16 }).notNull(),
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

// ──────────────────────────────────────────────────────────
// events —— Run 的事件流（持久化日志）
// ──────────────────────────────────────────────────────────

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    level: eventLevel("level").notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    message: text("message"),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  },
  (t) => ({
    byRun: index("idx_events_run_time").on(t.runId, t.occurredAt),
  }),
);

// ──────────────────────────────────────────────────────────
// items —— 抓取到的内容
// ──────────────────────────────────────────────────────────

export const items = pgTable(
  "items",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    runId: uuid("run_id").references(() => runs.id, {
      onDelete: "set null",
    }),
    spider: varchar("spider", { length: 64 }).notNull(),
    type: varchar("type", { length: 32 }).notNull(),
    url: text("url").notNull(),
    urlHash: char("url_hash", { length: 40 }).notNull(),
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
  }),
);

// ──────────────────────────────────────────────────────────
// visited —— URL 指纹去重表（跨 Run 共享）
// ──────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────
// settings —— 通用 KV
// ──────────────────────────────────────────────────────────

export const settings = pgTable("settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ──────────────────────────────────────────────────────────
// 类型导出（用于 repository / 调用方）
// ──────────────────────────────────────────────────────────

export type Spider = typeof spiders.$inferSelect;
export type NewSpider = typeof spiders.$inferInsert;

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type RunStatus = (typeof runStatus.enumValues)[number];

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type EventLevel = (typeof eventLevel.enumValues)[number];

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;

export type Visited = typeof visited.$inferSelect;

export type Setting = typeof settings.$inferSelect;
