import { type Prisma, RunStatus } from '@prisma/client';
import type { Db } from '../client';
import type { Run } from '../index';

export interface CreateRunInput {
  spiderName: string;
  triggerType: 'manual' | 'cron';
  overrides?: Record<string, unknown>;
}

function shape(row: { overrides: unknown; [k: string]: unknown }): Run {
  return {
    ...row,
    overrides: (row.overrides ?? null) as Record<string, unknown> | null,
  } as Run;
}

export async function create(db: Db, input: CreateRunInput): Promise<{ id: string }> {
  const row = await db.run.create({
    data: {
      spiderName: input.spiderName,
      triggerType: input.triggerType,
      overrides: (input.overrides ?? {}) as import('@prisma/client').Prisma.InputJsonValue,
    },
    select: { id: true },
  });
  return { id: row.id };
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
  spider?: string;
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

  const where: Prisma.RunWhereInput = {};
  if (params.spider) where.spiderName = params.spider;
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
