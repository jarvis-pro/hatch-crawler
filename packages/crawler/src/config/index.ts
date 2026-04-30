/**
 * 库级别的运行参数。
 *
 * 注意：本模块**不再读取 process.env**——库不应假设宿主进程的环境。
 * 调用方（CLI / Worker）按需把环境变量解析成 CrawlerConfig 后注入。
 */

export interface CrawlerConfig {
  /** pino 日志级别 */
  logLevel: string;
  /** 全局并发上限 */
  concurrency: number;
  /** 同一域名两次请求最小间隔（ms） */
  perHostIntervalMs: number;
  /** 单次请求超时（ms） */
  requestTimeoutMs: number;
  /** 临时性失败的重试次数 */
  retryAttempts: number;
  /** 代理 URL 列表 */
  proxyList: readonly string[];
}

export const defaultCrawlerConfig: CrawlerConfig = {
  logLevel: "info",
  concurrency: 4,
  perHostIntervalMs: 500,
  requestTimeoutMs: 15000,
  retryAttempts: 3,
  proxyList: [],
};

/**
 * 全局可变 config 引用，库内部模块（fetcher、spider）从这里读。
 * CLI / Worker 在启动时调用 setCrawlerConfig 注入实际值。
 */
let current: CrawlerConfig = defaultCrawlerConfig;

export function setCrawlerConfig(cfg: Partial<CrawlerConfig>): void {
  current = { ...defaultCrawlerConfig, ...current, ...cfg };
}

export function getCrawlerConfig(): CrawlerConfig {
  return current;
}

/** @deprecated 使用 getCrawlerConfig()，保留 config 是为兼容老代码 */
export const config = new Proxy({} as CrawlerConfig, {
  get(_target, prop: keyof CrawlerConfig) {
    return current[prop];
  },
});
