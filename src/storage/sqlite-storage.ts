import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { logger } from "../utils/logger.js";

export interface CrawlItem {
  url: string;
  spider: string;
  type: string;
  payload: Record<string, unknown>;
  fetchedAt?: number;
}

/**
 * Lightweight, dependency-free (no docker, no daemon) structured storage.
 * better-sqlite3 is synchronous which simplifies error handling here.
 *
 * Tables:
 *   items   — one row per scraped logical item
 *   visited — URL fingerprints we've completed; powers incremental crawl
 */
export class SqliteStorage {
  private readonly db: Database.Database;
  private readonly insertItem: Database.Statement;
  private readonly markVisited: Database.Statement;
  private readonly hasVisited: Database.Statement;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");

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

      CREATE TABLE IF NOT EXISTS visited (
        url_hash   TEXT PRIMARY KEY,
        url        TEXT NOT NULL,
        spider     TEXT NOT NULL,
        visited_at INTEGER NOT NULL
      );
    `);

    this.insertItem = this.db.prepare(`
      INSERT OR IGNORE INTO items
        (spider, type, url, url_hash, content_hash, payload, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    this.markVisited = this.db.prepare(`
      INSERT OR REPLACE INTO visited (url_hash, url, spider, visited_at)
      VALUES (?, ?, ?, ?)
    `);

    this.hasVisited = this.db.prepare(`
      SELECT 1 AS x FROM visited WHERE url_hash = ?
    `);

    logger.info({ path }, "sqlite storage ready");
  }

  /**
   * Insert a scraped item. Returns true if it was new content,
   * false if a row with identical (url, content) already exists —
   * useful for incremental crawl ("only emit when changed").
   */
  saveItem(item: CrawlItem): boolean {
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
    return info.changes > 0;
  }

  isVisited(urlHash: string): boolean {
    return this.hasVisited.get(urlHash) !== undefined;
  }

  markUrlVisited(url: string, urlHash: string, spider: string): void {
    this.markVisited.run(urlHash, url, spider, Date.now());
  }

  close(): void {
    this.db.close();
  }
}

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}
