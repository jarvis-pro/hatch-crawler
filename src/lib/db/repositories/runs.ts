import { type Prisma, RunStatus } from '@prisma/client';
import type { Db } from '../client';
import type { Run } from '../index';

export interface CreateRunInput {
  spiderId: string;
  spiderName: string;
  triggerType: 'manual' | 'cron';
  overrides?: Record<string, unknown>;
}

function shape(row: { overrides: unknown; spider_id?: unknown; [k: string]: unknown }): Run {
  return {
    ...row,
    // spider_id 列在 Prisma generate 前不在 PrismaRun 类型里，手动补入
    spiderId:
      (row.spider_id as string | null | undefined) ??
      (row.spiderId as string | null | undefined) ??
      null,
    overrides: (row.overrides ?? null) as Record<string, unknown> | null,
  } as Run;
}

export async function create(db: Db, input: CreateRunInput): Promise<{ id: string }> {
  // spider_id 列在 Prisma generate 前不被 Prisma client 认识，用原始 SQL 写入
  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO "runs" ("spider_name", "spider_id", "trigger_type", "overrides")
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING "id"`,
    input.spiderName,
    input.spiderId,
    input.triggerType,
    JSON.stringify(input.overrides ?? {}),
  );
  if (!rows[0]) throw new Error('run insert returned no row');
  return { id: rows[0].id };
}

export async function getById(db: Db, id: string): Promise<Run | null> {
  const row = await db.run.findUnique({ where: { id } });
  return row ? shape(row) : null;
}

export async function markStarted(db: Db, id: string): Promise<void> {
  await db.run.update({
    where: { id },
    data: { status: RunStatus.running, startedAt: new Date() },
  });
}

export async function markFinished(
  db: Db,
  id: string,
  status: 'completed' | 'failed' | 'stopped',
  errorMessage?: string,
): Promise<void> {
  await db.run.update({
    where: { id },
    data: {
      status: RunStatus[status],
      finishedAt: new Date(),
      errorMessage: errorMessage ?? null,
    },
  });
}

export async function incrementStats(
  db: Db,
  id: string,
  delta: Partial<{
    fetched: number;
    emitted: number;
    newItems: number;
    errors: number;
  }>,
): Promise<void> {
  const data: Prisma.RunUpdateInput = {};
  if (delta.fetched) data.fetched = { increment: delta.fetched };
  if (delta.emitted) data.emitted = { increment: delta.emitted };
  if (delta.newItems) data.newItems = { increment: delta.newItems };
  if (delta.errors) data.errors = { increment: delta.errors };
  if (Object.keys(data).length === 0) return;
  await db.run.update({ where: { id }, data });
}

export interface ListParams {
  /** spiders.id UUID，用于按 spider 实例过滤 */
  spiderId?: string;
  status?: RunStatus | RunStatus[];
  page?: number;
  pageSize?: number;
}

export async function list(
  db: Db,
  params: ListParams = {},
): Promise<{
  data: Run[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;

  // spiderId 在 Prisma generate 前不在 RunWhereInput，用原始 SQL 补充条件
  if (params.spiderId) {
    const statuses = params.status
      ? (Array.isArray(params.status) ? params.status : [params.status]).map(String)
      : null;

    const statusClause = statuses
      ? `AND r.status = ANY(ARRAY[${statuses.map((_, i) => `$${i + 2}`).join(',')}]::run_status[])`
      : '';

    const countArgs: unknown[] = [params.spiderId];
    const rowArgs: unknown[] = [params.spiderId];
    if (statuses) {
      countArgs.push(...statuses);
      rowArgs.push(...statuses);
    }
    rowArgs.push(pageSize, (page - 1) * pageSize);

    const countArgIdx = statuses ? statuses.length + 1 : 1;
    const [countResult, rows] = await Promise.all([
      db.$queryRawUnsafe<{ cnt: bigint }[]>(
        `SELECT COUNT(*) AS cnt FROM "runs" r WHERE r.spider_id = $1 ${statusClause}`,
        ...countArgs,
      ),
      db.$queryRawUnsafe<(Parameters<typeof shape>[0] & { spider_id?: string })[]>(
        `SELECT * FROM "runs" r WHERE r.spider_id = $1 ${statusClause}
         ORDER BY r.created_at DESC LIMIT $${countArgIdx + 1} OFFSET $${countArgIdx + 2}`,
        ...rowArgs,
      ),
    ]);

    return {
      data: rows.map((r) => shape({ ...r, spider_id: r.spider_id })),
      total: Number(countResult[0]?.cnt ?? 0),
      page,
      pageSize,
    };
  }

  // 无 spiderId 过滤时走 Prisma
  const where: Prisma.RunWhereInput = {};
  if (params.status) {
    where.status = Array.isArray(params.status) ? { in: params.status } : params.status;
  }

  const [rows, total] = await Promise.all([
    db.run.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    db.run.count({ where }),
  ]);

  return { data: rows.map(shape), total, page, pageSize };
}

export async function remove(db: Db, id: string): Promise<void> {
  await db.run.delete({ where: { id } });
}

/**
 * 批量删除运行记录，仅删除终态（completed / failed / stopped）的 run，
 * 跳过仍在运行或排队中的记录，返回实际删除数量。
 */
export async function removeMany(db: Db, ids: string[]): Promise<number> {
  const result = await db.run.deleteMany({
    where: {
      id: { in: ids },
      status: { in: [RunStatus.completed, RunStatus.failed, RunStatus.stopped] },
    },
  });
  return result.count;
}

/**
 * 启动时清理：把状态仍是 running 但很久没更新的 run 标记为 failed。
 *
 * 触发场景：上次 web 进程异常退出，DB 里留下假的 running 记录。
 */
export async function cleanupStale(db: Db, staleAfterMin = 30): Promise<number> {
  const threshold = new Date(Date.now() - staleAfterMin * 60_000);
  const result = await db.run.updateMany({
    where: {
      status: RunStatus.running,
      startedAt: { lt: threshold },
    },
    data: {
      status: RunStatus.failed,
      finishedAt: new Date(),
      errorMessage: 'stale: marked failed by startup cleanup',
    },
  });
  return result.count;
}
