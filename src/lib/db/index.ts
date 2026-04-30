/**
 * 数据库层公开 API（src/lib/db）
 */

// 客户端
export { getDb, closeDb, type Db } from "./client";
export { getBoss, closeBoss, QUEUE_CRAWL, type CrawlJobData } from "./boss";

// 迁移
export { runMigrations, type MigrateResult } from "./migrate";

// schema 全部表 + 类型
export * from "./schema";

// repositories（按命名空间导出，避免方法名冲突）
export * as runRepo from "./repositories/runs";
export * as itemRepo from "./repositories/items";
export * as eventRepo from "./repositories/events";
export * as settingRepo from "./repositories/settings";
export * as visitedRepo from "./repositories/visited";
export * as spiderRepo from "./repositories/spiders";
