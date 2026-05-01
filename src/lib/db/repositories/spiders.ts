import type { Db } from '../client';
import type { NewSpider, Spider } from '../index';

function shape(row: {
  startUrls: unknown;
  allowedHosts: unknown;
  defaultParams?: unknown;
  [k: string]: unknown;
}): Spider {
  return {
    ...row,
    startUrls: row.startUrls as string[],
    allowedHosts: row.allowedHosts as string[],
    defaultParams: (row.defaultParams ?? {}) as Record<string, unknown>,
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
  const base = {
    displayName: input.displayName,
    description: input.description ?? null,
    startUrls: input.startUrls,
    allowedHosts: input.allowedHosts ?? [],
    maxDepth: input.maxDepth ?? 2,
    concurrency: input.concurrency ?? 4,
    perHostIntervalMs: input.perHostIntervalMs ?? 500,
    enabled: input.enabled ?? true,
    cronSchedule: input.cronSchedule ?? null,
    defaultParams: input.defaultParams ?? {},
  };

  // defaultParams 列在 Prisma generate 前类型不存在，用宽松 cast
  const row = (await (db.spider.upsert as (args: unknown) => Promise<unknown>)({
    where: { name: input.name },
    create: { name: input.name, ...base },
    update: { ...base, updatedAt: new Date() },
  })) as Parameters<typeof shape>[0];

  return shape(row);
}

export async function remove(db: Db, name: string): Promise<void> {
  await db.spider.delete({ where: { name } });
}
