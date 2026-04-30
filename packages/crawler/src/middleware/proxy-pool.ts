import { HttpsProxyAgent } from "hpagent";
import { logger } from "../utils/logger.js";

interface ProxyEntry {
  url: string;
  failures: number;
  lastUsed: number;
}

/**
 * Round-robin proxy pool with simple failure tracking.
 * If you have a paid proxy provider, point PROXY_LIST at their endpoints.
 *
 * For learning: you can also start with PROXY_LIST empty and the crawler
 * will just send direct requests.
 */
export class ProxyPool {
  private readonly proxies: ProxyEntry[];
  private idx = 0;
  private readonly maxFailures = 3;

  constructor(urls: readonly string[]) {
    this.proxies = urls.map((url) => ({ url, failures: 0, lastUsed: 0 }));
    if (this.proxies.length > 0) {
      logger.info({ count: this.proxies.length }, "proxy pool initialized");
    }
  }

  get size(): number {
    return this.proxies.filter((p) => p.failures < this.maxFailures).length;
  }

  /** Pick the next available proxy, or null if pool is empty/exhausted. */
  next(): { url: string; agent: HttpsProxyAgent } | null {
    if (this.proxies.length === 0) return null;

    for (let i = 0; i < this.proxies.length; i++) {
      const entry = this.proxies[(this.idx + i) % this.proxies.length]!;
      if (entry.failures >= this.maxFailures) continue;
      entry.lastUsed = Date.now();
      this.idx = (this.idx + i + 1) % this.proxies.length;
      return {
        url: entry.url,
        agent: new HttpsProxyAgent({ proxy: entry.url, keepAlive: true }),
      };
    }
    return null;
  }

  reportFailure(url: string): void {
    const entry = this.proxies.find((p) => p.url === url);
    if (!entry) return;
    entry.failures += 1;
    if (entry.failures >= this.maxFailures) {
      logger.warn({ proxy: url }, "proxy disabled after repeated failures");
    }
  }

  reportSuccess(url: string): void {
    const entry = this.proxies.find((p) => p.url === url);
    if (entry && entry.failures > 0) entry.failures -= 1;
  }
}
