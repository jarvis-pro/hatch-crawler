/**
 * Storage 抽象。
 *
 * 让 packages/crawler 不绑定具体数据库——
 *  - CLI 注入 SqliteStorage
 *  - Worker 注入 PostgresStorage（在 apps/worker 里实现）
 *  - 测试时可以注入内存版
 *
 * 接口全部 async：哪怕底层是同步的 SQLite，也用 Promise 包一层，
 * 这样上层 spider 引擎不需要"sync 还是 async"两套代码。
 */

export interface CrawlItem {
  url: string;
  spider: string;
  type: string;
  payload: Record<string, unknown>;
  fetchedAt?: number;
}

export interface SaveItemResult {
  /** 内容是新的（spider+url+contentHash 在数据库里没出现过） */
  isNew: boolean;
}

export interface Storage {
  /** 持久化一条抓取结果 */
  saveItem(item: CrawlItem): Promise<SaveItemResult>;

  /** 这个 spider 是否抓过这个 URL（指纹命中） */
  isVisited(spider: string, urlHash: string): Promise<boolean>;

  /** 标记某个 URL 已抓过 */
  markVisited(spider: string, url: string, urlHash: string): Promise<void>;

  /** 释放底层资源（连接、文件句柄等） */
  close?(): Promise<void> | void;
}
