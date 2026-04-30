import PQueue from "p-queue";
import { Fetcher, type FetchResult } from "./fetcher.js";
import { UrlQueue, type QueueItem } from "./queue.js";
import { SqliteStorage, type CrawlItem } from "../storage/sqlite-storage.js";
import { JsonlWriter } from "../storage/file-storage.js";
import { config } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { urlFingerprint } from "../utils/url.js";

export interface SpiderContext {
  url: string;
  type: string;
  meta: Record<string, unknown>;
  depth: number;
  response: FetchResult;
  /** Schedule another URL for this spider to crawl. */
  enqueue: (next: Omit<QueueItem, "depth"> & { depth?: number }) => void;
  /** Emit a parsed item to storage. */
  emit: (item: Omit<CrawlItem, "spider">) => void;
}

/**
 * BaseSpider — extend this to write a new crawler.
 *
 * Subclasses define:
 *   - name        : string identifier (logging, storage tag)
 *   - startUrls   : list of seed URLs
 *   - parse(ctx)  : called for each successfully fetched page
 *
 * The engine handles concurrency, dedup, retries, storage, and stats.
 */
export abstract class BaseSpider {
  abstract readonly name: string;
  abstract readonly startUrls: ReadonlyArray<{ url: string; type?: string }>;
  readonly maxDepth: number = 3;

  abstract parse(ctx: SpiderContext): void | Promise<void>;
}

export interface RunOptions {
  storage: SqliteStorage;
  jsonl?: JsonlWriter;
  fetcher?: Fetcher;
}

export interface RunStats {
  fetched: number;
  emitted: number;
  newItems: number;
  errors: number;
  durationMs: number;
}

export async function runSpider(
  spider: BaseSpider,
  opts: RunOptions,
): Promise<RunStats> {
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

  // Seed
  for (const seed of spider.startUrls) {
    queue.push({ url: seed.url, type: seed.type ?? "seed", depth: 0 });
  }

  const handle = async (job: QueueItem): Promise<void> => {
    const fp = urlFingerprint(job.url);
    if (opts.storage.isVisited(fp)) {
      logger.debug({ url: job.url }, "skipping previously visited");
      return;
    }

    try {
      const response = await fetcher.fetch(job.url);
      stats.fetched += 1;

      if (response.status >= 400) {
        logger.warn(
          { url: job.url, status: response.status },
          "non-2xx, skipping parse",
        );
        return;
      }

      const ctx: SpiderContext = {
        url: job.url,
        type: job.type ?? "page",
        meta: job.meta ?? {},
        depth: job.depth,
        response,
        enqueue: (next) => {
          if ((next.depth ?? job.depth + 1) > spider.maxDepth) return;
          const ok = queue.push({
            url: next.url,
            type: next.type,
            meta: next.meta,
            depth: next.depth ?? job.depth + 1,
          });
          if (ok) drain();
        },
        emit: (item) => {
          stats.emitted += 1;
          const isNew = opts.storage.saveItem({ ...item, spider: spider.name });
          if (isNew) {
            stats.newItems += 1;
            opts.jsonl?.write({
              spider: spider.name,
              ...item,
              fetched_at: item.fetchedAt ?? Date.now(),
            });
          }
        },
      };

      await spider.parse(ctx);
      opts.storage.markUrlVisited(job.url, fp, spider.name);
    } catch (err) {
      stats.errors += 1;
      logger.error({ url: job.url, err: (err as Error).message }, "job failed");
    }
  };

  function drain(): void {
    while (
      queue.size > 0 &&
      pool.size + pool.pending < config.concurrency * 4
    ) {
      const job = queue.pop();
      if (!job) break;
      void pool.add(() => handle(job));
    }
  }

  drain();
  // Keep draining as new URLs come in
  const drainInterval = setInterval(drain, 50);
  await pool.onIdle();
  // One more pass — parse() might have enqueued things in flight
  drain();
  await pool.onIdle();
  clearInterval(drainInterval);

  stats.durationMs = Date.now() - start;
  logger.info({ spider: spider.name, ...stats }, "spider finished");
  return stats;
}
