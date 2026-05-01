import got, { type Got } from 'got';
import { setTimeout as sleep } from 'node:timers/promises';
import { logger } from '../utils/logger';

export interface ApiClientOptions {
  /** 每次请求之间的最小间隔（毫秒），防止触发 429 */
  perRequestDelayMs?: number;
  /** 重试次数 */
  retryAttempts?: number;
  /** 请求超时（毫秒） */
  timeoutMs?: number;
  /** 追加到每个请求的固定 headers */
  defaultHeaders?: Record<string, string>;
}

export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * 平台 REST API 调用客户端。
 *
 * 与 Fetcher（面向 HTML 抓取）不同，ApiClient：
 *   - 默认解析 JSON 响应
 *   - 不随机 UA（API 调用用固定 agent 字符串即可）
 *   - 不经过代理池（API 调用通常不需要代理）
 *   - 支持在 query 里注入 API key
 */
export class ApiClient {
  private readonly client: Got;
  private readonly perRequestDelayMs: number;
  private readonly retryAttempts: number;
  private lastCallAt = 0;

  constructor(opts: ApiClientOptions = {}) {
    this.perRequestDelayMs = opts.perRequestDelayMs ?? 200;
    this.retryAttempts = opts.retryAttempts ?? 3;

    this.client = got.extend({
      timeout: { request: opts.timeoutMs ?? 15_000 },
      followRedirect: true,
      throwHttpErrors: false,
      decompress: true,
      retry: { limit: 0 },
      headers: {
        'user-agent': 'hatch-crawler/1.0',
        accept: 'application/json',
        ...opts.defaultHeaders,
      },
    });
  }

  /** 速率限制：保证两次调用之间至少间隔 perRequestDelayMs */
  private async throttle(): Promise<void> {
    const now = Date.now();
    const gap = this.lastCallAt + this.perRequestDelayMs - now;
    if (gap > 0) await sleep(gap);
    this.lastCallAt = Date.now();
  }

  async get<T = unknown>(
    url: string,
    params?: Record<string, string | number | undefined>,
  ): Promise<ApiResponse<T>> {
    // 把 params 追加到 URL（忽略 undefined 值）
    const fullUrl = params
      ? (() => {
          const u = new URL(url);
          for (const [k, v] of Object.entries(params)) {
            if (v !== undefined) u.searchParams.set(k, String(v));
          }
          return u.toString();
        })()
      : url;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      await this.throttle();
      try {
        const res = await this.client.get(fullUrl);

        if (res.statusCode === 429) {
          const backoff = Math.min(1000 * 2 ** attempt, 30_000);
          logger.warn({ url: fullUrl, attempt, backoff }, 'API rate limited, backing off');
          await sleep(backoff);
          continue;
        }

        let data: T;
        try {
          data = JSON.parse(res.body) as T;
        } catch {
          data = res.body as unknown as T;
        }

        return { status: res.statusCode, data, headers: res.headers };
      } catch (err) {
        lastErr = err;
        const backoff = Math.min(500 * 2 ** attempt, 10_000);
        logger.warn(
          { url: fullUrl, attempt, backoff, err: (err as Error).message },
          'API call failed, will retry',
        );
        if (attempt < this.retryAttempts) await sleep(backoff);
      }
    }

    throw new Error(
      `API GET ${fullUrl} failed after ${this.retryAttempts} attempts: ${
        (lastErr as Error)?.message ?? 'unknown'
      }`,
    );
  }
}
