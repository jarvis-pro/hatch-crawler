/**
 * @hatch-crawler/db —— 数据库层公开 API
 */

// 客户端
export { getDb, closeDb, type Db } from "./client.js";
export {
  getBoss,
  closeBoss,
  QUEUE_CRAWL,
  type CrawlJobData,
} from "./boss.js";

// 迁移
export { runMigrations, type MigrateResult } from "./migrate.js";

// schema 全部表 + 类型
export * from "./schema.js";

// repositories（按命名空间导出，避免方法名冲突）
export * as runRepo from "./repositories/runs.js";
export * as itemRepo from "./repositories/items.js";
export * as eventRepo from "./repositories/events.js";
export * as settingRepo from "./repositories/settings.js";
export * as visitedRepo from "./repositories/visited.js";
export * as spiderRepo from "./repositories/spiders.js";
