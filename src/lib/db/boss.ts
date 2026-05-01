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
export const QUEUE_DOWNLOAD = 'download';
export const QUEUE_TRANSCODE = 'transcode';

export interface CrawlJobData {
  runId: string;
  /** spiders.id UUID */
  spiderId: string;
  overrides?: Record<string, unknown>;
}

/**
 * RFC 0002 Phase A：下载 job 入队负载。
 *
 * attachment 行在派发前必须已经 create（status=queued），这里只传 id；
 * job-handler 取出 attachment 行后再走 fetcher → storage → mark completed。
 */
export interface DownloadJobData {
  attachmentId: string;
}

/**
 * RFC 0002 Phase B：转码 job 入队负载。
 *
 * 派生 attachment 已在 API 层创建（parentId 指向源、status=queued、
 * transcodeOp='video_to_mp3'），这里只传 id。
 */
export interface TranscodeJobData {
  attachmentId: string;
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
