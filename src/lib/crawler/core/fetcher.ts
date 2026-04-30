import got, { type Got, type OptionsOfTextResponseBody } from "got";
import { setTimeout as sleep } from "node:timers/promises";
import { config } from "../config/index";
import { logger } from "../utils/logger";
import { getHost } from "../utils/url";
import { UAPool } from "../middleware/ua-pool";
import { ProxyPool } from "../middleware/proxy-pool";
import { HostRateLimiter } from "../middleware/rate-limiter";

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface FetcherOptions {
  uaPool?: UAPool;
  proxyPool?: ProxyPool;
  rateLimiter?: HostRateLimiter;
}

/**
 * Fetcher composes:
 *  - per-host rate limiting (politeness)
 *  - UA rotation (avoid trivial UA fingerprinting)
 *  - proxy rotation (when PROXY_LIST is set)
 *  - exponential-backoff retry on transient failures
 *
 * It returns the raw body — parsing is the parser layer's job.
 */
export class Fetcher {
  private readonly client: Got;
  private readonly uaPool: UAPool;
  private readonly proxyPool: ProxyPool;
  private readonly rateLimiter: HostRateLimiter;

  constructor(opts: FetcherOptions = {}) {
    this.uaPool = opts.uaPool ?? new UAPool();
    this.proxyPool = opts.proxyPool ?? new ProxyPool(config.proxyList);
    this.rateLimiter =
      opts.rateLimiter ?? new HostRateLimiter(config.perHostIntervalMs);

    this.client = got.extend({
      timeout: { request: config.requestTimeoutMs },
      followRedirect: true,
      throwHttpErrors: false,
      decompress: true,
      retry: { limit: 0 }, // we manage retries ourselves
    });
  }

  async fetch(
    url: string,
    init?: OptionsOfTextResponseBody,
  ): Promise<FetchResult> {
    const host = getHost(url);
    if (!host) throw new Error(`Invalid URL: ${url}`);

    let lastErr: unknown;
    for (let attempt = 1; attempt <= config.retryAttempts; attempt++) {
      await this.rateLimiter.acquire(host);

      const proxy = this.proxyPool.next();
      const headers: Record<string, string> = {
        "user-agent": this.uaPool.random(),
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.5",
        "accept-language": "en-US,en;q=0.9",
        ...((init?.headers as Record<string, string> | undefined) ?? {}),
      };

      try {
        const res = await this.client(url, {
          ...init,
          headers,
          ...(proxy && {
            agent: { https: proxy.agent, http: proxy.agent },
          }),
        });

        // 2xx success
        if (res.statusCode >= 200 && res.statusCode < 300) {
          if (proxy) this.proxyPool.reportSuccess(proxy.url);
          return {
            url,
            finalUrl: res.url,
            status: res.statusCode,
            body: res.body,
            headers: res.headers,
          };
        }

        // Treat 5xx and 429 as retryable
        if (res.statusCode >= 500 || res.statusCode === 429) {
          throw new Error(`HTTP ${res.statusCode}`);
        }

        // 4xx (other than 429) — don't retry, return as-is
        if (proxy) this.proxyPool.reportSuccess(proxy.url);
        return {
          url,
          finalUrl: res.url,
          status: res.statusCode,
          body: res.body,
          headers: res.headers,
        };
      } catch (err) {
        lastErr = err;
        if (proxy) this.proxyPool.reportFailure(proxy.url);
        const backoff = Math.min(2000 * 2 ** (attempt - 1), 15_000);
        logger.warn(
          { url, attempt, backoff, err: (err as Error).message },
          "fetch failed, will retry",
        );
        if (attempt < config.retryAttempts) await sleep(backoff);
      }
    }

    throw new Error(
      `Fetch ${url} failed after ${config.retryAttempts} attempts: ${
        (lastErr as Error)?.message ?? "unknown"
      }`,
    );
  }
}
