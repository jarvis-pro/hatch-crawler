import type { Db } from '../client';
import type { NewSpider, Spider } from '../index';

function shape(row: { startUrls: unknown; allowedHosts: unknown; [k: string]: unknown }): Spider {
  return {
    ...row,
    startUrls: row.startUrls as string[],
    allowedHosts: row.allowedHosts as string[],
  } as Spider;
}

export async function listAll(db: Db): Promise<Spider[]> {
  const rows = await db.spider.findMany({ orderBy: { name: 'asc' } });
  return rows.map(shape);
}

export async function getByName(db: Db, name: string): Promise<Spider | null> {
  const row = await db.spider.findUnique({ where: { name } });
  return row ? shape(row) : null;
}

export async function upsert(db: Db, input: NewSpider): Promise<Spider> {
  const row = await db.spider.upsert({
    where: { name: input.name },
    create: {
      name: input.name,
      displayName: input.displayName,
      description: input.description ?? null,
      startUrls: input.startUrls,
      allowedHosts: input.allowedHosts ?? [],
      maxDepth: input.maxDepth ?? 2,
      concurrency: input.concurrency ?? 4,
      perHostIntervalMs: input.perHostIntervalMs ?? 500,
      enabled: input.enabled ?? true,
      cronSchedule: input.cronSchedule ?? null,
    },
    update: {
      displayName: input.displayName,
      description: input.description ?? null,
      startUrls: input.startUrls,
      allowedHosts: input.allowedHosts ?? [],
      maxDepth: input.maxDepth ?? 2,
      concurrency: input.concurrency ?? 4,
      perHostIntervalMs: input.perHostIntervalMs ?? 500,
      enabled: input.enabled ?? true,
      cronSchedule: input.cronSchedule ?? null,
      updatedAt: new Date(),
    },
  });
  return shape(row);
}

export async function remove(db: Db, name: string): Promise<void> {
  await db.spider.delete({ where: { name } });
}
