import { PrismaClient } from '@prisma/client';

/**
 * Prisma 客户端工厂。
 *
 * 单例：第一次调用建客户端（内部维护连接池），后续调用复用。
 * 用 `globalThis` 守卫避免 Next.js dev 热重载时反复建客户端。
 */

export type Db = PrismaClient;

interface CachedClient {
  db: PrismaClient;
  url: string;
}

const CACHE_KEY = '__hatchCrawlerDbClient';
const globalCache = globalThis as typeof globalThis & {
  [CACHE_KEY]?: CachedClient;
};

export function getDb(databaseUrl: string): Db {
  const cached = globalCache[CACHE_KEY];
  if (cached && cached.url === databaseUrl) return cached.db;

  // URL 变了或第一次：先关旧的（不阻塞）
  if (cached) {
    void cached.db.$disconnect().catch(() => {});
  }

  const db = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  globalCache[CACHE_KEY] = { db, url: databaseUrl };
  return db;
}

export async function closeDb(): Promise<void> {
  const cached = globalCache[CACHE_KEY];
  if (!cached) return;
  await cached.db.$disconnect();
  delete globalCache[CACHE_KEY];
}
