import type { Db } from '../client';
import type { NewSpider, Spider } from '../index';

/**
 * spiders 仓储层。
 *
 * Prisma generate 尚未更新前，id 列不在生成的 client 类型里，
 * 因此全部使用原始 SQL，避免 Prisma client 运行时校验报错。
 */

interface RawRow {
  id: string;
  name: string;
  type: string;
  description: string | null;
  start_urls: unknown;
  allowed_hosts: unknown;
  max_depth: number;
  concurrency: number;
  per_host_interval_ms: number;
  enabled: boolean;
  cron_schedule: string | null;
  platform: string | null;
  emits_kinds: unknown;
  default_params: unknown;
  task_kind: string;
  created_at: Date;
  updated_at: Date;
}

const SELECT_COLS = `
  "id", "name", "type", "description",
  "start_urls", "allowed_hosts",
  "max_depth", "concurrency", "per_host_interval_ms",
  "enabled", "cron_schedule", "platform", "emits_kinds",
  "default_params", "task_kind",
  "created_at", "updated_at"
`.trim();

function shape(row: RawRow): Spider {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    description: row.description ?? null,
    startUrls: (row.start_urls as string[]) ?? [],
    allowedHosts: (row.allowed_hosts as string[]) ?? [],
    maxDepth: row.max_depth ?? 2,
    concurrency: row.concurrency ?? 4,
    perHostIntervalMs: row.per_host_interval_ms ?? 500,
    enabled: row.enabled ?? true,
    cronSchedule: row.cron_schedule ?? null,
    platform: row.platform ?? null,
    emitsKinds: (row.emits_kinds as string[]) ?? [],
    defaultParams: (row.default_params as Record<string, unknown>) ?? {},
    taskKind: row.task_kind ?? 'batch',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } as Spider;
}

/** 派生 task_kind：按规则从 type + cron_schedule 推断（供 create/update 时使用） */
export function deriveTaskKind(
  type: string,
  cronSchedule: string | null | undefined,
  explicit?: string | null,
): string {
  if (explicit) return explicit;
  if (type === 'url-extractor') return 'extract';
  if (cronSchedule) return 'subscription';
  return 'batch';
}

export async function listAll(db: Db): Promise<Spider[]> {
  const rows = await db.$queryRawUnsafe<RawRow[]>(
    `SELECT ${SELECT_COLS} FROM "spiders" ORDER BY "name" ASC`,
  );
  return rows.map(shape);
}

export async function listByTaskKind(db: Db, taskKind: string): Promise<Spider[]> {
  const rows = await db.$queryRawUnsafe<RawRow[]>(
    `SELECT ${SELECT_COLS} FROM "spiders" WHERE "task_kind" = $1 ORDER BY "name" ASC`,
    taskKind,
  );
  return rows.map(shape);
}

export async function getById(db: Db, id: string): Promise<Spider | null> {
  const rows = await db.$queryRawUnsafe<RawRow[]>(
    `SELECT ${SELECT_COLS} FROM "spiders" WHERE "id" = $1::uuid`,
    id,
  );
  return rows[0] ? shape(rows[0]) : null;
}

/** @deprecated worker / 旧代码兼容；新代码应使用 getById */
export async function getByName(db: Db, name: string): Promise<Spider | null> {
  const rows = await db.$queryRawUnsafe<RawRow[]>(
    `SELECT ${SELECT_COLS} FROM "spiders" WHERE "name" = $1 LIMIT 1`,
    name,
  );
  return rows[0] ? shape(rows[0]) : null;
}

/**
 * 按 type（注册表键）查找首条 spider 行。
 *
 * 用途：内置/单实例 spider（如 url-extractor）通过 type 反查 id，
 * 避免在调用方写死 UUID。返回最早创建的一条（如果有重复）。
 */
export async function getByType(db: Db, type: string): Promise<Spider | null> {
  const rows = await db.$queryRawUnsafe<RawRow[]>(
    `SELECT ${SELECT_COLS} FROM "spiders" WHERE "type" = $1 ORDER BY "created_at" ASC LIMIT 1`,
    type,
  );
  return rows[0] ? shape(rows[0]) : null;
}

export async function create(db: Db, input: NewSpider): Promise<Spider> {
  const taskKind = deriveTaskKind(input.type, input.cronSchedule, input.taskKind);
  const rows = await db.$queryRawUnsafe<RawRow[]>(
    `INSERT INTO "spiders" (
      "name", "type", "description",
      "start_urls", "allowed_hosts",
      "max_depth", "concurrency", "per_host_interval_ms",
      "enabled", "cron_schedule", "platform",
      "default_params", "task_kind"
    ) VALUES (
      $1, $2, $3,
      $4::jsonb, $5::jsonb,
      $6, $7, $8,
      $9, $10, $11,
      $12::jsonb, $13
    ) RETURNING ${SELECT_COLS}`,
    input.name,
    input.type,
    input.description ?? null,
    JSON.stringify(input.startUrls ?? []),
    JSON.stringify(input.allowedHosts ?? []),
    input.maxDepth ?? 2,
    input.concurrency ?? 4,
    input.perHostIntervalMs ?? 500,
    input.enabled ?? true,
    input.cronSchedule ?? null,
    input.platform ?? null,
    JSON.stringify(input.defaultParams ?? {}),
    taskKind,
  );
  if (!rows[0]) throw new Error('spider insert returned no row');
  return shape(rows[0]);
}

export async function update(db: Db, id: string, input: NewSpider): Promise<Spider> {
  const taskKind = deriveTaskKind(input.type, input.cronSchedule, input.taskKind);
  const rows = await db.$queryRawUnsafe<RawRow[]>(
    `UPDATE "spiders" SET
      "name"                 = $1,
      "type"                 = $2,
      "description"          = $3,
      "start_urls"           = $4::jsonb,
      "allowed_hosts"        = $5::jsonb,
      "max_depth"            = $6,
      "concurrency"          = $7,
      "per_host_interval_ms" = $8,
      "enabled"              = $9,
      "cron_schedule"        = $10,
      "platform"             = $11,
      "default_params"       = $12::jsonb,
      "task_kind"            = $13,
      "updated_at"           = now()
    WHERE "id" = $14::uuid
    RETURNING ${SELECT_COLS}`,
    input.name,
    input.type,
    input.description ?? null,
    JSON.stringify(input.startUrls ?? []),
    JSON.stringify(input.allowedHosts ?? []),
    input.maxDepth ?? 2,
    input.concurrency ?? 4,
    input.perHostIntervalMs ?? 500,
    input.enabled ?? true,
    input.cronSchedule ?? null,
    input.platform ?? null,
    JSON.stringify(input.defaultParams ?? {}),
    taskKind,
    id,
  );
  if (!rows[0]) throw new Error(`spider not found: ${id}`);
  return shape(rows[0]);
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.$executeRawUnsafe(`DELETE FROM "spiders" WHERE "id" = $1::uuid`, id);
}

/**
 * 连续失败次数 +1，并返回更新后的次数。
 * 超过 maxAllowed 时同时把 enabled 置为 false（自动停用）。
 */
export async function recordFailure(
  db: Db,
  id: string,
  maxAllowed: number,
): Promise<{ consecutiveFailures: number; disabled: boolean }> {
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
    await db.$executeRawUnsafe(`UPDATE "spiders" SET "enabled" = false WHERE "id" = $1::uuid`, id);
    disabled = true;
  }

  return { consecutiveFailures: cf, disabled };
}

/**
 * 运行成功后将连续失败次数重置为 0。
 */
export async function resetFailures(db: Db, id: string): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE "spiders" SET "consecutive_failures" = 0 WHERE "id" = $1::uuid`,
    id,
  );
}
