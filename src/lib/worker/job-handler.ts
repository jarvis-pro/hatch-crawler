import 'server-only';
import { type Db, eventRepo, runRepo, accountRepo } from '@/lib/db';
import { runSpider, setCrawlerConfig } from '@/lib/crawler';
import type { CrawlerEvent, EventLevel } from '@/lib/shared';
import type { CrawlJobData } from '@/lib/db';
import { getSpiderEntry } from '../spider-registry';
import { PostgresStorage } from './postgres-storage';
import { publish } from './event-bus';
import { env } from '@/lib/env';

/**
 * 单个 crawl job 的处理函数。
 *
 * 流程：
 *  1. markStarted
 *  2. 应用 overrides → setCrawlerConfig
 *  3. runSpider，注入 PostgresStorage、onEvent 桥接到 events 表 + EventBus
 *  4. markFinished
 *
 * 抛错由 pg-boss 自己捕获并按 retryLimit 重试；
 * 这里我们主动捕获把 run 标记 failed 后再 rethrow，让 pg-boss 知道。
 */
export async function handleCrawlJob(
  db: Db,
  data: CrawlJobData,
  signal: AbortSignal,
): Promise<void> {
  const { runId, spider, overrides } = data;

  const entry = getSpiderEntry(spider);
  if (!entry) {
    await runRepo.markFinished(db, runId, 'failed', `unknown spider: ${spider}`);
    throw new Error(`unknown spider: ${spider}`);
  }

  await runRepo.markStarted(db, runId);

  // 应用 overrides 到全局 crawler config
  if (overrides) {
    setCrawlerConfig(overrides);
  }

  // 组装 Spider 构造参数：overrides 中的值 + 平台凭据注入
  const spiderParams: Record<string, unknown> = { ...(overrides ?? {}) };

  if (entry.platform) {
    // 自动注入平台 API key（如有）
    const apiKey = await accountRepo.getActivePayload(
      db,
      entry.platform,
      'apikey',
      env.accountsMasterKey,
    );
    if (apiKey) spiderParams.apiKey = apiKey;

    // 自动注入平台 Cookie（如有，用于 XHS 等 cookie 鉴权平台）
    const cookie = await accountRepo.getActivePayload(
      db,
      entry.platform,
      'cookie',
      env.accountsMasterKey,
    );
    if (cookie) spiderParams.cookie = cookie;
  }

  // 桥接事件：写 events 表（异步）+ 推 EventBus（同步给 SSE）
  const onEvent = (event: CrawlerEvent): void => {
    publish(runId, event);

    // debug 级别不入库
    if (event.level === 'debug') return;

    void eventRepo
      .append(db, {
        runId,
        level: event.level as EventLevel,
        type: event.type,
        message: extractMessage(event),
        payload: extractPayload(event),
      })
      .catch(() => {
        // 写日志失败不阻塞抓取
      });

    // 增量统计也异步同步到 runs 表
    if (event.type === 'fetched') {
      void runRepo.incrementStats(db, runId, { fetched: 1 }).catch(() => {});
    } else if (event.type === 'emitted') {
      const delta = event.isNew ? { emitted: 1, newItems: 1 } : { emitted: 1 };
      void runRepo.incrementStats(db, runId, delta).catch(() => {});
    } else if (event.type === 'error') {
      void runRepo.incrementStats(db, runId, { errors: 1 }).catch(() => {});
    }
  };

  try {
    const spiderInstance = entry.factory(spiderParams);
    const storage = new PostgresStorage(db, runId);
    await runSpider(spiderInstance, { storage, onEvent, signal });

    if (signal.aborted) {
      await runRepo.markFinished(db, runId, 'stopped');
    } else {
      await runRepo.markFinished(db, runId, 'completed');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await runRepo.markFinished(db, runId, 'failed', message);
    throw err;
  }
}

function extractMessage(event: CrawlerEvent): string {
  switch (event.type) {
    case 'fetched':
      return `fetched ${event.url} → ${String(event.status)} (${String(event.durationMs)}ms)`;
    case 'queued':
      return `queued ${event.url} (depth ${String(event.depth)})`;
    case 'skipped':
      return `skipped ${event.url} (${event.reason})`;
    case 'emitted':
      return `emitted ${event.itemType}: ${event.url}${event.isNew ? '' : ' (dup)'}`;
    case 'fetch_failed':
      return `fetch failed (attempt ${String(event.attempt)}): ${event.url} — ${event.error}`;
    case 'error':
      return event.message;
    case 'done':
      return `done: fetched=${String(event.stats.fetched)} new=${String(event.stats.newItems)} errors=${String(event.stats.errors)}`;
    default:
      return event.type;
  }
}

function extractPayload(event: CrawlerEvent): Record<string, unknown> {
  // 把 type/level/at 之外的字段作为 payload 入库
  const { type: _type, level: _level, at: _at, ...rest } = event;
  return rest as Record<string, unknown>;
}
