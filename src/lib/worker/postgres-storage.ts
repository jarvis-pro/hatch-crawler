import 'server-only';
import { createHash } from 'node:crypto';
import { type Db, itemRepo, visitedRepo } from '@/lib/db';
import type { CrawlItem, SaveItemResult, Storage } from '@/lib/crawler';

/**
 * Storage 接口的 Postgres 实现。
 * 由 worker 在 job-handler 里实例化、注入给 runSpider。
 *
 * runId 在构造时绑定，所有写入会关联到这个 run。
 */
export class PostgresStorage implements Storage {
  constructor(
    private readonly db: Db,
    private readonly runId: string,
  ) {}

  async saveItem(item: CrawlItem): Promise<SaveItemResult> {
    return itemRepo.save(this.db, {
      runId: this.runId,
      spider: item.spider,
      type: item.type,
      url: item.url,
      payload: item.payload,
    });
  }

  isVisited(spider: string, urlHash: string): Promise<boolean> {
    return visitedRepo.isVisited(this.db, spider, urlHash);
  }

  async markVisited(spider: string, url: string, urlHash: string): Promise<void> {
    await visitedRepo.mark(this.db, spider, url, urlHash);
  }
}

/** 计算 URL 指纹，与 packages/crawler 的 urlFingerprint 等价 */
export function urlFingerprint(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.searchParams.sort();
    return createHash('sha1').update(u.toString()).digest('hex');
  } catch {
    return createHash('sha1').update(url).digest('hex');
  }
}
