import { and, eq } from "drizzle-orm";
import type { Db } from "../client";
import { visited } from "../schema";

export async function isVisited(
  db: Db,
  spider: string,
  urlHash: string,
): Promise<boolean> {
  const rows = await db
    .select({ urlHash: visited.urlHash })
    .from(visited)
    .where(and(eq(visited.spider, spider), eq(visited.urlHash, urlHash)))
    .limit(1);
  return rows.length > 0;
}

export async function mark(
  db: Db,
  spider: string,
  url: string,
  urlHash: string,
): Promise<void> {
  await db
    .insert(visited)
    .values({ spider, url, urlHash })
    .onConflictDoNothing();
}

/** 用户清理某个 spider 的所有 visited 记录（强制重抓） */
export async function clearSpider(db: Db, spider: string): Promise<number> {
  const rows = await db
    .delete(visited)
    .where(eq(visited.spider, spider))
    .returning({ urlHash: visited.urlHash });
  return rows.length;
}
