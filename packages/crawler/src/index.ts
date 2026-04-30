/**
 * @hatch-crawler/crawler — 爬虫核心引擎库
 *
 * 这里只导出对外稳定的公共 API，
 * 内部模块（utils/_logger 等）原则上不暴露。
 */

// 核心引擎
export {
  Fetcher,
  type FetchResult,
  type FetcherOptions,
} from "./core/fetcher.js";
export { UrlQueue, type QueueItem } from "./core/queue.js";
export {
  BaseSpider,
  runSpider,
  type SpiderContext,
  type RunOptions,
} from "./core/spider.js";
export { scheduleOrRunOnce, type ScheduleHandle } from "./core/scheduler.js";

// 中间件
export { UAPool } from "./middleware/ua-pool.js";
export { ProxyPool } from "./middleware/proxy-pool.js";
export { HostRateLimiter } from "./middleware/rate-limiter.js";

// 解析器
export {
  extractNextData,
  buildNextDataUrl,
  type NextData,
} from "./parsers/next-data-parser.js";
export {
  loadHtml,
  extractLinks,
  extractMeta,
  type Cheerio,
} from "./parsers/html-parser.js";

// 存储抽象与默认 SQLite 实现
export type {
  Storage,
  CrawlItem,
  SaveItemResult,
} from "./storage/storage.js";
export { SqliteStorage } from "./storage/sqlite-storage.js";
export { JsonlWriter } from "./storage/file-storage.js";

// 工具
export { urlFingerprint, getHost, resolveUrl } from "./utils/url.js";
export { logger, type Logger } from "./utils/logger.js";

// 内置示例 Spider
export { NextJsBlogSpider } from "./spiders/nextjs-blog-spider.js";

// 默认配置
export {
  defaultCrawlerConfig,
  setCrawlerConfig,
  getCrawlerConfig,
  type CrawlerConfig,
} from "./config/index.js";
