import 'server-only';
import { getBoss, getDb, QUEUE_CRAWL, runRepo } from '@/lib/db';
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

  // 3) 订阅队列
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

  // 4) 监听 abort 请求（来自 POST /api/runs/:id/stop）
  // 通过 EventBus 的特殊频道 "stop"
  // 因 EventBus 已按 runId 索引，这里我们直接每个 runId 注册一个 listener
  // —— 但 pg-boss 拉到 job 时才知道 runId。所以改用 globalThis 上的"abort 表"：
  // 上层 stop 路由直接调 abortRun(runId) 即可，无需经 EventBus
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
