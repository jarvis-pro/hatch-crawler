import 'server-only';
import { type Db, eventRepo, runRepo, accountRepo, settingRepo, spiderRepo } from '@/lib/db';
import { dispatchForRun, isYoutubeDownloadEnabled } from './attachment-dispatcher';
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

  // 记录本次 run 使用的账号 ID（用于失败后回写 failureCount）
  const usedAccountIds: number[] = [];

  if (entry.platform) {
    // 自动注入平台 API key（如有）
    const apiKeyAccount = await accountRepo.getActiveAccount(
      db,
      entry.platform,
      'apikey',
      env.accountsMasterKey,
    );
    if (apiKeyAccount) {
      spiderParams.apiKey = apiKeyAccount.payload;
      usedAccountIds.push(apiKeyAccount.id);
    }

    // 自动注入平台 Cookie（如有，用于 XHS 等 cookie 鉴权平台）
    const cookieAccount = await accountRepo.getActiveAccount(
      db,
      entry.platform,
      'cookie',
      env.accountsMasterKey,
    );
    if (cookieAccount) {
      spiderParams.cookie = cookieAccount.payload;
      usedAccountIds.push(cookieAccount.id);
    }
  }

  // 注入代理列表（从 settings 表的 proxy_pool key 读取）
  const proxyList = await settingRepo.get<string[]>(db, 'proxy_pool').catch(() => null);
  if (Array.isArray(proxyList) && proxyList.length > 0) {
    spiderParams.proxyUrls = proxyList;
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
    } else if (event.type === 'error' && event.level === 'error') {
      // 仅严重级别才计入 errors；warn/info 走相同 type='error' 通道但属于诊断信息
      void runRepo.incrementStats(db, runId, { errors: 1 }).catch(() => {});
    }
  };

  // 读取连续失败告警阈值（默认 3）
  const maxConsecutiveFailures = Number(
    (await settingRepo.get<number>(db, 'max_consecutive_failures').catch(() => null)) ?? 3,
  );

  try {
    const spiderInstance = entry.factory(spiderParams);

    // 提前检查 startUrls，避免静默完成：若为空说明必填参数（如 apiKey / query / channelId）未配置
    if (spiderInstance.startUrls.length === 0) {
      throw new Error(
        `spider "${spider}" 的 startUrls 为空——请检查平台凭据（Accounts 页）及必填参数是否已配置。`,
      );
    }

    const storage = new PostgresStorage(db, runId);
    await runSpider(spiderInstance, { storage, onEvent, signal });

    const finalStatus = signal.aborted ? 'stopped' : 'completed';
    await runRepo.markFinished(db, runId, finalStatus);

    // 成功时重置连续失败计数
    void spiderRepo.resetFailures(db, spider).catch(() => {});
    void notifyWebhook(db, runId, spider, finalStatus).catch(() => {});

    // RFC 0002 Phase D：autoDownload 自动派发本次 run 的附件
    if (finalStatus === 'completed') {
      const spiderRow = await spiderRepo.getByName(db, spider).catch(() => null);
      if (spiderRow?.autoDownload) {
        const allowYoutube = await isYoutubeDownloadEnabled(db);
        const summary = await dispatchForRun(db, runId, { allowYoutube }).catch((err: unknown) => {
          const m = err instanceof Error ? err.message : String(err);
          return { items: 0, queued: 0, skipped: 0, errors: 1, _error: m } as const;
        });
        // 不阻塞主流程，仅记录到 events 让看板可见
        void eventRepo
          .append(db, {
            runId,
            level: 'info' as const,
            type: 'auto_download',
            message: `autoDownload: queued=${String(summary.queued)} skipped=${String(summary.skipped)} errors=${String(summary.errors)}`,
            payload: summary,
          })
          .catch(() => {});
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await runRepo.markFinished(db, runId, 'failed', message);

    // 递增连续失败计数，超阈值自动停用并发送告警
    const failureResult = await spiderRepo
      .recordFailure(db, spider, maxConsecutiveFailures)
      .catch(() => null);

    void notifyWebhook(db, runId, spider, 'failed', message).catch(() => {});

    if (failureResult?.disabled) {
      // 额外推送"停用告警"webhook
      void notifyWebhook(
        db,
        runId,
        spider,
        'auto_disabled',
        `连续失败 ${failureResult.consecutiveFailures} 次，已自动停用`,
      ).catch(() => {});
    }

    // 将失败记录到本次使用的账号（触发 failureCount 递增，超阈值自动 ban）
    for (const accountId of usedAccountIds) {
      void accountRepo.recordFailure(db, accountId).catch(() => {});
    }
    throw err;
  }
}

/**
 * 向配置的 Webhook URL 发送运行结果通知。
 * 失败时静默忽略，不影响主流程。
 */
async function notifyWebhook(
  db: Db,
  runId: string,
  spider: string,
  status: string,
  errorMessage?: string,
): Promise<void> {
  const webhookUrl = await settingRepo.get<string>(db, 'webhook_url').catch(() => null);
  if (!webhookUrl || typeof webhookUrl !== 'string') return;

  const body = JSON.stringify({
    event: 'run_finished',
    runId,
    spider,
    status,
    ...(errorMessage ? { errorMessage } : {}),
    at: new Date().toISOString(),
  });

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });
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
