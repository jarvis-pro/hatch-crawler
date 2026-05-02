import PgBoss from 'pg-boss';

/**
 * pg-boss 客户端工厂。
 *
 * pg-boss 用同一个 Postgres 数据库做任务队列。
 * 它会在 `pgboss` schema 下自管表（不归我们的 prisma schema 管）。
 *
 * 单例：第一次调用启动 boss，后续复用。
 */

export const QUEUE_CRAWL = 'crawl';

/**
 * 快取任务专用队列：与 crawl 解耦，不经过 spider/run/event 体系。
 * 每条 supported URL 单独入队 → ExtractJobData，并发由 pg-boss 自动调度。
 */
export const QUEUE_EXTRACT = 'extract';

export interface CrawlJobData {
  runId: string;
  /** spiders.id UUID */
  spiderId: string;
  overrides?: Record<string, unknown>;
}

export interface ExtractJobData {
  /** extract_jobs.id UUID —— worker 写完结果后回更其计数 */
  extractJobId: string;
  /** 用户原始提交的 URL（标准化前），用于 UI 回显与审计 */
  originalUrl: string;
  /** inspect 标准化后的 URL；同时是 results map 的 key 与 items.url */
  canonicalUrl: string;
  /** 命中的平台（用于路由 extractor，避免 worker 里再做一次 dispatch） */
  platform: string;
}

interface CachedBoss {
  boss: PgBoss;
  url: string;
  ready: Promise<void>;
}

const CACHE_KEY = '__hatchCrawlerBossClient';
const globalCache = globalThis as typeof globalThis & {
  [CACHE_KEY]?: CachedBoss;
};

export function getBoss(databaseUrl: string): {
  boss: PgBoss;
  ready: Promise<void>;
} {
  const cached = globalCache[CACHE_KEY];
  if (cached && cached.url === databaseUrl) {
    return { boss: cached.boss, ready: cached.ready };
  }

  if (cached) {
    void cached.boss.stop({ graceful: false }).catch(() => {});
  }

  const boss = new PgBoss({
    connectionString: databaseUrl,
    schema: 'pgboss',
    // 监控参数，按 pg-boss 默认即可
    retryLimit: 3,
    retryBackoff: true,
  });
  const ready = boss.start().then(() => undefined);

  globalCache[CACHE_KEY] = { boss, url: databaseUrl, ready };
  return { boss, ready };
}

export async function closeBoss(): Promise<void> {
  const cached = globalCache[CACHE_KEY];
  if (!cached) return;
  await cached.boss.stop({ graceful: true });
  delete globalCache[CACHE_KEY];
}
