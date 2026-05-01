/* eslint-disable no-console */
/**
 * 烟雾测试：用内存 Storage 跑一次 Spider，验证引擎工作。
 *
 * 仅作开发调试用——不依赖 Postgres、不依赖任何外部服务，
 * 适合改完引擎想 30 秒内确认"没把基本功能弄坏"。
 *
 * 用法：
 *   pnpm smoke
 *
 * 默认跑 BilibiliSearchSpider（无需 API key），如需测试其他 spider 可修改此脚本。
 */

import { runSpider, setCrawlerConfig } from '../src/lib/crawler';
import { BilibiliSearchSpider } from '../src/lib/crawler/platforms/bilibili/spiders/search';
import type { CrawlItem, SaveItemResult, Storage } from '../src/lib/crawler/storage/storage';

class InMemoryStorage implements Storage {
  private items: CrawlItem[] = [];
  private visited = new Set<string>();

  saveItem(item: CrawlItem): Promise<SaveItemResult> {
    this.items.push(item);
    return Promise.resolve({ isNew: true });
  }

  isVisited(spider: string, urlHash: string): Promise<boolean> {
    return Promise.resolve(this.visited.has(`${spider}:${urlHash}`));
  }

  markVisited(spider: string, _url: string, urlHash: string): Promise<void> {
    this.visited.add(`${spider}:${urlHash}`);
    return Promise.resolve();
  }

  get itemCount(): number {
    return this.items.length;
  }
}

async function main(): Promise<void> {
  setCrawlerConfig({
    concurrency: 2,
    perHostIntervalMs: 1000,
    requestTimeoutMs: 15000,
    retryAttempts: 2,
    proxyList: [],
    logLevel: 'info',
  });

  const storage = new InMemoryStorage();
  const stats = await runSpider(new BilibiliSearchSpider({ query: 'TypeScript', maxPages: 1 }), {
    storage,
    onEvent: (e) => {
      const url = 'url' in e ? e.url : '';
      console.log(`[${e.type}]`, url);
    },
  });

  console.log('\n==== smoke test done ====');
  console.log('storage items:', storage.itemCount);
  console.log('stats:', stats);
}

main().catch((err: unknown) => {
  console.error('smoke test failed:', err);
  process.exit(1);
});
