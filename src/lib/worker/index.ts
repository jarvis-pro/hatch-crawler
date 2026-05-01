import 'server-only';
import { getBoss, getDb, QUEUE_CRAWL, runRepo, spiderRepo } from '@/lib/db';
import type { CrawlJobData } from '@/lib/db';
import { env } from '../env';
import { handleCrawlJob } from './job-handler';
import { subscribe } from './event-bus';

/**
 * Worker 启动入口（被 instrumentation.ts 调用）。
 *
 * 单例：全局只跑一次 worker；用 globalThis 守卫 Next.js dev 热重载。
 *
 * 职责：
 *  1. 启动时清理 stale running runs
 *  2. 订阅 pg-boss `crawl` 队列
 *  3. 监听 EventBus 上的 stop:* 频道，收到就 abort 当前 job
 */

interface WorkerState {
  started: boolean;
  abortControllers: Map<string, AbortController>;
}

const CACHE_KEY = '__hatchCrawlerWorker';
const globalCache = globalThis as typeof globalThis & {
  [CACHE_KEY]?: WorkerState;
};

function getState(): WorkerState {
  if (!globalCache[CACHE_KEY]) {
    globalCache[CACHE_KEY] = {
      started: false,
      abortControllers: new Map(),
    };
  }
  return globalCache[CACHE_KEY]!;
}

/** cron 触发队列前缀；每个 spider 独占一条队列 */
const QUEUE_CRON_PREFIX = 'crawl-cron:';

/**
 * 注册或更新单条 Spider 的 cron 调度。
 * - cronExpression 为 null / 空串：取消调度
 * - 幂等：重复调用安全
 *
 * @param spiderId   spiders.id UUID（作为 pg-boss 队列名后缀，保证多实例唯一）
 */
export async function syncSpiderSchedule(
  spiderId: string,
  cronExpression: string | null,
): Promise<void> {
  const { boss, ready } = getBoss(env.databaseUrl);
  await ready;
  const db = getDb(env.databaseUrl);

  const queueName = `${QUEUE_CRON_PREFIX}${spiderId}`;

  if (!cronExpression) {
    try {
      await boss.unschedule(queueName);
    } catch {
      // 不存在也无妨
    }
    return;
  }

  await boss.createQueue(queueName);
  await boss.schedule(queueName, cronExpression, { spiderId });

  // 保证有 work 处理器
  await boss.work<{ spiderId: string }>(queueName, async ([job]) => {
    if (!job) return;
    const { spiderId: sid } = job.data;
    const spider = await spiderRepo.getById(db, sid);
    if (!spider) return; // Spider 已被删除，跳过
    const run = await runRepo.create(db, {
      spiderId: sid,
      spiderName: spider.name,
      triggerType: 'cron',
    });
    await boss.send(QUEUE_CRAWL, { runId: run.id, spiderId: sid } satisfies CrawlJobData);
  });
}

export async function startWorker(): Promise<void> {
  const state = getState();
  if (state.started) return;
  state.started = true;

  const db = getDb(env.databaseUrl);
  const { boss, ready } = getBoss(env.databaseUrl);
  await ready;

  // 1) 清理 stale runs
  const cleaned = await runRepo.cleanupStale(db, 30);
  if (cleaned > 0) {
    console.warn(`[worker] cleaned ${String(cleaned)} stale runs`);
  }

  // 2) 创建队列（pg-boss v10 起需要显式 createQueue）
  await boss.createQueue(QUEUE_CRAWL);

  // 3) 订阅 crawl 队列
  await boss.work<CrawlJobData>(QUEUE_CRAWL, async ([job]) => {
    if (!job) return;
    const ac = new AbortController();
    state.abortControllers.set(job.data.runId, ac);
    try {
      await handleCrawlJob(db, job.data, ac.signal);
    } finally {
      state.abortControllers.delete(job.data.runId);
    }
  });

  // 4) 注册所有启用 Spider 的 cron 调度
  const allSpiders = await spiderRepo.listAll(db);
  for (const spider of allSpiders) {
    if (spider.cronSchedule) {
      await syncSpiderSchedule(spider.id, spider.cronSchedule).catch((err) => {
        console.warn(`[worker] failed to register schedule for ${spider.id}:`, err);
      });
    }
  }

  // 5) 监听 abort 请求
  console.warn('[worker] started');
}

/** 由 POST /api/runs/:id/stop 调用，触发当前 job 的 AbortSignal */
export function abortRun(runId: string): boolean {
  const state = getState();
  const ac = state.abortControllers.get(runId);
  if (!ac) return false;
  ac.abort();
  return true;
}

// 也 re-export EventBus 的订阅接口，方便 SSE 路由使用
export { subscribe };
