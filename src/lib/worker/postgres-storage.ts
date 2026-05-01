import 'server-only';
import { type Db, itemRepo } from '@/lib/db';
import type { CrawlItem, SaveItemResult, Storage } from '@/lib/crawler';
import { logger } from '@/lib/crawler';
import { KIND_SCHEMAS, KNOWN_KINDS } from '@/lib/crawler/kinds';

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
    // Phase 5：对携带已知 kind 的 item 做软校验（失败只 warn，不阻断抓取）
    if (item.kind && KNOWN_KINDS.includes(item.kind as (typeof KNOWN_KINDS)[number])) {
      const schema = KIND_SCHEMAS[item.kind as (typeof KNOWN_KINDS)[number]];
      const result = schema.safeParse({
        ...item.payload,
        platform: item.platform,
        kind: item.kind,
        sourceId: item.sourceId,
        url: item.url,
      });
      if (!result.success) {
        logger.warn(
          { kind: item.kind, url: item.url, issues: result.error.issues },
          'item payload failed kind schema validation',
        );
      }
    }
    return itemRepo.save(this.db, {
      runId: this.runId,
      spider: item.spider,
      type: item.type,
      url: item.url,
      payload: item.payload,
      platform: item.platform ?? null,
      kind: item.kind ?? null,
      sourceId: item.sourceId ?? null,
    });
  }
}
