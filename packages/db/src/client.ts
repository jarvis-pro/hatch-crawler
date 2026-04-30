import postgres, { type Sql } from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

/**
 * Drizzle 客户端工厂。
 *
 * 单例：第一次调用建连接池，后续调用复用。
 * 用 `globalThis` 守卫避免 Next.js dev 热重载时反复建池。
 */

export type Db = ReturnType<typeof drizzle<typeof schema>>;

interface CachedClient {
  sql: Sql;
  db: Db;
  url: string;
}

const CACHE_KEY = "__hatchCrawlerDbClient";
const globalCache = globalThis as typeof globalThis & {
  [CACHE_KEY]?: CachedClient;
};

export function getDb(databaseUrl: string): Db {
  const cached = globalCache[CACHE_KEY];
  if (cached && cached.url === databaseUrl) return cached.db;

  // URL 变了或第一次：先关旧的（不阻塞）
  if (cached) {
    void cached.sql.end({ timeout: 1 }).catch(() => {});
  }

  const sql = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 30,
    prepare: false,
  });
  const db = drizzle(sql, { schema, casing: "snake_case" });

  globalCache[CACHE_KEY] = { sql, db, url: databaseUrl };
  return db;
}

export async function closeDb(): Promise<void> {
  const cached = globalCache[CACHE_KEY];
  if (!cached) return;
  await cached.sql.end({ timeout: 5 });
  delete globalCache[CACHE_KEY];
}
