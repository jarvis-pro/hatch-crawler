import 'server-only';
import {
  type Db,
  eventRepo,
  runRepo,
  accountRepo,
  settingRepo,
  SETTINGS_KEYS,
  spiderRepo,
} from '@/lib/db';
import { runSpider, setCrawlerConfig } from '@/lib/crawler';
import type { CrawlerEvent, EventLevel } from '@/lib/shared';
import type { CrawlJobData } from '@/lib/db';
import { getSpiderEntry, listSpiderNames } from '../spider-registry';
import { PostgresStorage } from './postgres-storage';
import { publish } from './event-bus';
import { notifyWebhook } from './webhook';
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
  const { runId, spiderId, overrides } = data;

  // spiderId = spiders.id UUID。取 spider 行，用 spider.type 作为注册表键查找实现类。
  const spiderRow = await spiderRepo.getById(db, spiderId).catch(() => null);
  const registryKey = spiderRow?.type ?? spiderId;

  const entry = getSpiderEntry(registryKey);
  if (!entry) {
    // 把当前注册表里的 keys 一并打出来，便于区分两种根因：
    //  a) 真没注册（代码漏了）
    //  b) worker 持有旧版注册表（dev HMR 后没重启进程，常见）
    const known = listSpiderNames().sort().join(', ');
    const detail = `unknown spider type: ${registryKey} (spiderId: ${spiderId}); known types: [${known}]`;
    await runRepo.markFinished(db, runId, 'failed', detail);
    throw new Error(detail);
  }

  // task_kind 已在 run 创建时写入，从 spiderRow 取出传给 storage
  const taskKind = spiderRow?.taskKind ?? null;

  await runRepo.markStarted(db, runId);

  // 应用 overrides 到全局 crawler config
  if (overrides) {
    setCrawlerConfig(overrides);
  }

  // 组装 Spider 构造参数：defaultParams 打底，overrides 覆盖，最后注入平台凭据
  const spiderParams: Record<string, unknown> = {
    ...(spiderRow?.defaultParams ?? {}),
    ...(overrides ?? {}),
  };

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
  const proxyList = await settingRepo.get<string[]>(db, SETTINGS_KEYS.proxyPool).catch(() => null);
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
    (await settingRepo.get<number>(db, SETTINGS_KEYS.maxConsecutiveFailures).catch(() => null)) ??
      3,
  );

  try {
    const spiderInstance = entry.factory(spiderParams);

    // 提前检查 startUrls，避免静默完成：若为空说明必填参数（如 apiKey / query / channelId）未配置
    if (spiderInstance.startUrls.length === 0) {
      throw new Error(
        `spider "${registryKey}" 的 startUrls 为空——请检查平台凭据（Accounts 页）及必填参数是否已配置。`,
      );
    }

    const storage = new PostgresStorage(db, runId, taskKind, spiderId);
    await runSpider(spiderInstance, { storage, onEvent, signal });

    const finalStatus = signal.aborted ? 'stopped' : 'completed';
    await runRepo.markFinished(db, runId, finalStatus);

    // 成功时重置连续失败计数（豁免类 spider 跳过——例如 url-extractor）
    if (!entry.excludeFromAutoDisable) {
      void spiderRepo.resetFailures(db, spiderId).catch(() => {});
    }
    void notifyWebhook(db, runId, registryKey, finalStatus).catch(() => {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await runRepo.markFinished(db, runId, 'failed', message);

    // 豁免类 spider（例如 url-extractor）：失败不计入连续失败、不触发自动停用、
    // 也不连带 ban 账号——失败多源于用户输入而非 spider 逻辑/凭据问题。
    if (!entry.excludeFromAutoDisable) {
      // 递增连续失败计数，超阈值自动停用并发送告警
      const failureResult = await spiderRepo
        .recordFailure(db, spiderId, maxConsecutiveFailures)
        .catch(() => null);

      if (failureResult?.disabled) {
        // 额外推送"停用告警"webhook
        void notifyWebhook(
          db,
          runId,
          registryKey,
          'auto_disabled',
          `连续失败 ${failureResult.consecutiveFailures} 次，已自动停用`,
        ).catch(() => {});
      }

      // 将失败记录到本次使用的账号（触发 failureCount 递增，超阈值自动 ban）
      for (const accountId of usedAccountIds) {
        void accountRepo.recordFailure(db, accountId).catch(() => {});
      }
    }

    void notifyWebhook(db, runId, registryKey, 'failed', message).catch(() => {});

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
