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
    // platform 写入：允许传 null（通用爬虫），传值时直接存
    platform: input.platform ?? null,
    defaultParams: input.defaultParams ?? {},
    autoDownload: input.autoDownload ?? false,
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

/**
 * 连续失败次数 +1，并返回更新后的次数。
 * 超过 maxAllowed 时同时把 enabled 置为 false（自动停用）。
 * 返回 { consecutiveFailures, disabled }
 */
export async function recordFailure(
  db: Db,
  name: string,
  maxAllowed: number,
): Promise<{ consecutiveFailures: number; disabled: boolean }> {
  // 用 $executeRawUnsafe 递增（Prisma 类型尚未生成该列）
  await db.$executeRawUnsafe(
    `UPDATE "spiders" SET "consecutive_failures" = "consecutive_failures" + 1 WHERE "name" = $1`,
    name,
  );

  // 读回最新值
  const rows = await db.$queryRawUnsafe<{ cf: number }[]>(
    `SELECT "consecutive_failures" AS cf FROM "spiders" WHERE "name" = $1`,
    name,
  );
  const cf = rows[0]?.cf ?? 1;

  let disabled = false;
  if (cf >= maxAllowed) {
    await db.$executeRawUnsafe(`UPDATE "spiders" SET "enabled" = false WHERE "name" = $1`, name);
    disabled = true;
  }

  return { consecutiveFailures: cf, disabled };
}

/**
 * 运行成功后将连续失败次数重置为 0。
 */
export async function resetFailures(db: Db, name: string): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE "spiders" SET "consecutive_failures" = 0 WHERE "name" = $1`,
    name,
  );
}
