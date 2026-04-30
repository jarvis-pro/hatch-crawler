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
} from "./core/fetcher";
export { UrlQueue, type QueueItem } from "./core/queue";
export {
  BaseSpider,
  runSpider,
  type SpiderContext,
  type RunOptions,
} from "./core/spider";
// scheduleOrRunOnce / ScheduleHandle 不再从入口导出：
// v1 用 pg-boss 做调度，node-cron 是 CLI 时代的实现，
// 把它从公共 API 拿掉避免 bundler 把 node-cron 拉进 web 进程。
// 需要的话仍可从 ./core/scheduler 直接 import。

// 中间件
export { UAPool } from "./middleware/ua-pool";
export { ProxyPool } from "./middleware/proxy-pool";
export { HostRateLimiter } from "./middleware/rate-limiter";

// 解析器
export {
  extractNextData,
  buildNextDataUrl,
  type NextData,
} from "./parsers/next-data-parser";
export {
  loadHtml,
  extractLinks,
  extractMeta,
  type Cheerio,
} from "./parsers/html-parser";

// 存储抽象与默认 SQLite 实现
export type {
  Storage,
  CrawlItem,
  SaveItemResult,
} from "./storage/storage";
export { SqliteStorage } from "./storage/sqlite-storage";
export { JsonlWriter } from "./storage/file-storage";

// 工具
export { urlFingerprint, getHost, resolveUrl } from "./utils/url";
export { logger, type Logger } from "./utils/logger";

// 内置示例 Spider
export { NextJsBlogSpider } from "./spiders/nextjs-blog-spider";

// 默认配置
export {
  defaultCrawlerConfig,
  setCrawlerConfig,
  getCrawlerConfig,
  type CrawlerConfig,
} from "./config/index";
