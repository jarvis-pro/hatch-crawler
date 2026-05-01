import type { Db } from '../client';

export async function isVisited(db: Db, spider: string, urlHash: string): Promise<boolean> {
  const row = await db.visited.findUnique({
    where: { spider_urlHash: { spider, urlHash } },
    select: { urlHash: true },
  });
  return row !== null;
}

export async function mark(db: Db, spider: string, url: string, urlHash: string): Promise<void> {
  await db.visited.upsert({
    where: { spider_urlHash: { spider, urlHash } },
    create: { spider, url, urlHash },
    update: {}, // 已存在 → 不动
  });
}

/** 用户清理某个 spider 的所有 visited 记录（强制重抓） */
export async function clearSpider(db: Db, spider: string): Promise<number> {
  const result = await db.visited.deleteMany({ where: { spider } });
  return result.count;
}
