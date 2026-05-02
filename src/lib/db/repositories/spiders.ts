import type { Prisma } from '@prisma/client';
import type { Db } from '../client';
import type { NewSpider, Spider, TaskKind } from '../index';

/**
 * spiders 仓储层。
 *
 * db:generate 完成后全部走 Prisma ORM。
 * 例外：consecutiveFailures 列（刚加进 schema.prisma，需再跑一次 db:generate 才入 client 类型）
 * — recordFailure / resetFailures 暂时保留原始 SQL，见内部注释。
 */

/** 把 PrismaSpider 的 jsonb 字段收紧为业务类型 */
function shape(row: Awaited<ReturnType<Db['spider']['findUniqueOrThrow']>>): Spider {
  return {
    ...row,
    startUrls: (row.startUrls as string[]) ?? [],
    allowedHosts: (row.allowedHosts as string[]) ?? [],
    defaultParams: (row.defaultParams as Record<string, unknown>) ?? {},
    emitsKinds: (row.emitsKinds as string[]) ?? [],
    taskKind: (row.taskKind as TaskKind) ?? 'batch',
  } as Spider;
}

/** 派生 task_kind：按规则从 type + cron_schedule 推断（供 create/update 时使用） */
export function deriveTaskKind(
  type: string,
  cronSchedule: string | null | undefined,
  explicit?: TaskKind | string | null,
): TaskKind {
  if (explicit) return explicit as TaskKind;
  if (type === 'url-extractor') return 'extract';
  if (cronSchedule) return 'subscription';
  return 'batch';
}

export async function listAll(db: Db): Promise<Spider[]> {
  const rows = await db.spider.findMany({ orderBy: { name: 'asc' } });
  return rows.map(shape);
}

export async function listByTaskKind(db: Db, taskKind: string): Promise<Spider[]> {
  const rows = await db.spider.findMany({
    where: { taskKind },
    orderBy: { name: 'asc' },
  });
  return rows.map(shape);
}

export async function getById(db: Db, id: string): Promise<Spider | null> {
  const row = await db.spider.findUnique({ where: { id } });
  return row ? shape(row) : null;
}

/** @deprecated worker / 旧代码兼容；新代码应使用 getById */
export async function getByName(db: Db, name: string): Promise<Spider | null> {
  const row = await db.spider.findFirst({ where: { name } });
  return row ? shape(row) : null;
}

/**
 * 按 type（注册表键）查找首条 spider 行。
 *
 * 用途：内置/单实例 spider（如 url-extractor）通过 type 反查 id，
 * 避免在调用方写死 UUID。返回最早创建的一条（如果有重复）。
 */
export async function getByType(db: Db, type: string): Promise<Spider | null> {
  const row = await db.spider.findFirst({
    where: { type },
    orderBy: { createdAt: 'asc' },
  });
  return row ? shape(row) : null;
}

export async function create(db: Db, input: NewSpider): Promise<Spider> {
  const taskKind = deriveTaskKind(input.type, input.cronSchedule, input.taskKind);
  const row = await db.spider.create({
    data: {
      name: input.name,
      type: input.type,
      description: input.description ?? null,
      startUrls: input.startUrls ?? [],
      allowedHosts: input.allowedHosts ?? [],
      maxDepth: input.maxDepth ?? 2,
      concurrency: input.concurrency ?? 4,
      perHostIntervalMs: input.perHostIntervalMs ?? 500,
      enabled: input.enabled ?? true,
      cronSchedule: input.cronSchedule ?? null,
      platform: input.platform ?? null,
      defaultParams: (input.defaultParams ?? {}) as Prisma.InputJsonValue,
      taskKind,
    },
  });
  return shape(row);
}

export async function update(db: Db, id: string, input: NewSpider): Promise<Spider> {
  const taskKind = deriveTaskKind(input.type, input.cronSchedule, input.taskKind);
  const row = await db.spider.update({
    where: { id },
    data: {
      name: input.name,
      type: input.type,
      description: input.description ?? null,
      startUrls: input.startUrls ?? [],
      allowedHosts: input.allowedHosts ?? [],
      maxDepth: input.maxDepth ?? 2,
      concurrency: input.concurrency ?? 4,
      perHostIntervalMs: input.perHostIntervalMs ?? 500,
      enabled: input.enabled ?? true,
      cronSchedule: input.cronSchedule ?? null,
      platform: input.platform ?? null,
      defaultParams: (input.defaultParams ?? {}) as Prisma.InputJsonValue,
      taskKind,
      updatedAt: new Date(),
    },
  });
  return shape(row);
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.spider.delete({ where: { id } });
}

/**
 * 连续失败次数 +1，并返回更新后的次数。
 * 超过 maxAllowed 时同时把 enabled 置为 false（自动停用）。
 *
 * TODO: consecutiveFailures 已加入 schema.prisma，跑 pnpm db:generate 后
 *       可改为纯 Prisma（db.spider.update + increment）。
 */
export async function recordFailure(
  db: Db,
  id: string,
  maxAllowed: number,
): Promise<{ consecutiveFailures: number; disabled: boolean }> {
  // 原子 +1
  await db.$executeRawUnsafe(
    `UPDATE "spiders" SET "consecutive_failures" = "consecutive_failures" + 1 WHERE "id" = $1::uuid`,
    id,
  );
  const rows = await db.$queryRawUnsafe<{ cf: number }[]>(
    `SELECT "consecutive_failures" AS cf FROM "spiders" WHERE "id" = $1::uuid`,
    id,
  );
  const cf = rows[0]?.cf ?? 1;

  let disabled = false;
  if (cf >= maxAllowed) {
    await db.spider.update({ where: { id }, data: { enabled: false } });
    disabled = true;
  }
  return { consecutiveFailures: cf, disabled };
}

/**
 * 运行成功后将连续失败次数重置为 0。
 *
 * TODO: 跑 pnpm db:generate 后可改为：
 *   db.spider.update({ where: { id }, data: { consecutiveFailures: 0 } })
 */
export async function resetFailures(db: Db, id: string): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE "spiders" SET "consecutive_failures" = 0 WHERE "id" = $1::uuid`,
    id,
  );
}
