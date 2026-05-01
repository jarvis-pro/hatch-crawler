import PQueue from 'p-queue';
import type { CrawlerEvent, RunStats } from '@/lib/shared';
import { Fetcher, type FetchResult } from './fetcher';
import { UrlQueue, type QueueItem } from './queue';
import type { CrawlItem, Storage } from '../storage/storage';
import { getCrawlerConfig } from '../config/index';
import { logger } from '../utils/logger';
import { urlFingerprint } from '../utils/url';

export interface SpiderContext {
  url: string;
  type: string;
  meta: Record<string, unknown>;
  depth: number;
  response: FetchResult;
  /** 让 Spider 派发更多 URL 进队列 */
  enqueue: (next: Omit<QueueItem, 'depth'> & { depth?: number }) => void;
  /** 让 Spider 提交一条解析结果 */
  emit: (item: Omit<CrawlItem, 'spider'>) => void;
  /**
   * 让 Spider 上报运行期诊断信息（API 业务错误、空响应、配额提示等）。
   * 这条消息会写进 events 表 + 推到 SSE 日志流；level='error' 才计入 RunStats.errors。
   */
  log: (
    level: 'info' | 'warn' | 'error',
    message: string,
    payload?: Record<string, unknown>,
  ) => void;
}

/**
 * BaseSpider —— 写新爬虫继承它。
 *
 * 子类必须定义：
 *   - name        : 标识符（日志、storage 表里都用它）
 *   - startUrls   : 种子 URL
 *   - parse(ctx)  : 每个抓到的页面会被调一次
 *
 * 引擎处理：并发、去重、重试、存储、事件广播。
 */
export abstract class BaseSpider {
  abstract readonly name: string;
  abstract readonly startUrls: ReadonlyArray<{ url: string; type?: string }>;
  readonly maxDepth: number = 3;

  abstract parse(ctx: SpiderContext): void | Promise<void>;
}

export interface RunOptions {
  /** 持久化层 */
  storage: Storage;
  /** 可选：自定义 fetcher（测试或注入特殊配置） */
  fetcher?: Fetcher;
  /** 可选：外部停止信号 */
  signal?: AbortSignal;
  /** 可选：观察者，每个 CrawlerEvent 都会调一次 */
  onEvent?: (e: CrawlerEvent) => void;
}

export async function runSpider(spider: BaseSpider, opts: RunOptions): Promise<RunStats> {
  const config = getCrawlerConfig();
  const fetcher = opts.fetcher ?? new Fetcher();
  const queue = new UrlQueue();
  const pool = new PQueue({ concurrency: config.concurrency });
  const stats: RunStats = {
    fetched: 0,
    emitted: 0,
    newItems: 0,
    errors: 0,
    durationMs: 0,
  };
  const start = Date.now();

  const emit = (e: CrawlerEvent): void => {
    opts.onEvent?.(e);
  };

  // 种子
  for (const seed of spider.startUrls) {
    if (queue.push({ url: seed.url, type: seed.type ?? 'seed', depth: 0 })) {
      emit({
        type: 'queued',
        level: 'debug',
        url: seed.url,
        depth: 0,
        at: Date.now(),
      });
    }
  }

  const handleJob = async (job: QueueItem): Promise<void> => {
    if (opts.signal?.aborted) return;

    const fp = urlFingerprint(job.url);
    if (await opts.storage.isVisited(spider.name, fp)) {
      emit({
        type: 'skipped',
        level: 'debug',
        url: job.url,
        reason: 'visited',
        at: Date.now(),
      });
      return;
    }

    const fetchStart = Date.now();
    try {
      const response = await fetcher.fetch(job.url);
      stats.fetched += 1;
      emit({
        type: 'fetched',
        level: 'info',
        url: job.url,
        finalUrl: response.finalUrl,
        status: response.status,
        durationMs: Date.now() - fetchStart,
        at: Date.now(),
      });

      if (response.status >= 400) {
        emit({
          type: 'skipped',
          level: 'warn',
          url: job.url,
          reason: 'non_2xx',
          at: Date.now(),
        });
        return;
      }

      const ctx: SpiderContext = {
        url: job.url,
        type: job.type ?? 'page',
        meta: job.meta ?? {},
        depth: job.depth,
        response,
        log: (level, message, payload) => {
          emit({
            type: 'error',
            level,
            url: job.url,
            message,
            ...(payload ? { payload } : {}),
            at: Date.now(),
          });
        },
        enqueue: (next) => {
          const depth = next.depth ?? job.depth + 1;
          if (depth > spider.maxDepth) {
            emit({
              type: 'skipped',
              level: 'debug',
              url: next.url,
              reason: 'depth',
              at: Date.now(),
            });
            return;
          }
          const ok = queue.push({
            url: next.url,
            type: next.type,
            meta: next.meta,
            depth,
          });
          if (ok) {
            emit({
              type: 'queued',
              level: 'debug',
              url: next.url,
              depth,
              at: Date.now(),
            });
            drain();
          }
        },
        emit: (item) => {
          stats.emitted += 1;
          // 异步写入；失败不阻塞主流程
          void opts.storage
            .saveItem({ ...item, spider: spider.name })
            .then(({ isNew }) => {
              if (isNew) stats.newItems += 1;
              emit({
                type: 'emitted',
                level: 'info',
                url: item.url,
                itemType: item.type,
                isNew,
                at: Date.now(),
              });
            })
            .catch((err: unknown) => {
              stats.errors += 1;
              emit({
                type: 'error',
                level: 'error',
                url: item.url,
                message: (err as Error).message,
                at: Date.now(),
              });
            });
        },
      };

      await spider.parse(ctx);
      await opts.storage.markVisited(spider.name, job.url, fp);
    } catch (err) {
      stats.errors += 1;
      logger.error({ url: job.url, err: (err as Error).message }, 'job failed');
      emit({
        type: 'error',
        level: 'error',
        url: job.url,
        message: (err as Error).message,
        at: Date.now(),
      });
    }
  };

  function drain(): void {
    if (opts.signal?.aborted) return;
    while (queue.size > 0 && pool.size + pool.pending < config.concurrency * 4) {
      const job = queue.pop();
      if (!job) break;
      void pool.add(() => handleJob(job));
    }
  }

  drain();
  const drainInterval = setInterval(drain, 50);
  await pool.onIdle();
  drain();
  await pool.onIdle();
  clearInterval(drainInterval);

  stats.durationMs = Date.now() - start;
  emit({ type: 'done', level: 'info', stats, at: Date.now() });
  logger.info({ spider: spider.name, ...stats }, 'spider finished');
  return stats;
}
