import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { logger } from '../utils/logger';
import type { CrawlItem, SaveItemResult, Storage } from './storage';

/**
 * SQLite 实现。同步 API 包成 async 以满足 Storage 接口。
 *
 * 适用于 CLI 形态（单进程）。多进程并发写入会有锁竞争——
 * Worker/Web 同时跑的场景请用 PostgresStorage（在 apps/worker 里实现）。
 */
export class SqliteStorage implements Storage {
  private readonly db: Database.Database;
  private readonly insertItem: Database.Statement;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        spider      TEXT NOT NULL,
        type        TEXT NOT NULL,
        url         TEXT NOT NULL,
        url_hash    TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        payload     TEXT NOT NULL,
        fetched_at  INTEGER NOT NULL,
        UNIQUE(spider, url_hash, content_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_items_spider_type ON items(spider, type);
      CREATE INDEX IF NOT EXISTS idx_items_fetched_at  ON items(fetched_at);
    `);

    this.insertItem = this.db.prepare(`
      INSERT OR IGNORE INTO items
        (spider, type, url, url_hash, content_hash, payload, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    logger.info({ path }, 'sqlite storage ready');
  }

  async saveItem(item: CrawlItem): Promise<SaveItemResult> {
    const json = JSON.stringify(item.payload);
    const urlHash = sha1(item.url);
    const contentHash = sha1(json);
    const fetchedAt = item.fetchedAt ?? Date.now();
    const info = this.insertItem.run(
      item.spider,
      item.type,
      item.url,
      urlHash,
      contentHash,
      json,
      fetchedAt,
    );
    return { isNew: info.changes > 0 };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}
