import { type EventLevel, type Prisma } from '@prisma/client';
import type { Db } from '../client';
import type { Event } from '../index';

export interface AppendEventInput {
  runId: string;
  level: EventLevel;
  type: string;
  message?: string;
  payload?: Record<string, unknown>;
}

function shape(row: { payload: unknown; [k: string]: unknown }): Event {
  return {
    ...row,
    payload: (row.payload ?? null) as Record<string, unknown> | null,
  } as Event;
}

export async function append(db: Db, input: AppendEventInput): Promise<void> {
  await db.event.create({
    data: {
      runId: input.runId,
      level: input.level,
      type: input.type,
      message: input.message ?? null,
      payload: input.payload ?? {},
    },
  });
}

export interface ListParams {
  runId: string;
  level?: EventLevel;
  page?: number;
  pageSize?: number;
}

export async function list(
  db: Db,
  params: ListParams,
): Promise<{
  data: Event[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 100;

  const where: Prisma.EventWhereInput = { runId: params.runId };
  if (params.level) where.level = params.level;

  const [rows, total] = await Promise.all([
    db.event.findMany({
      where,
      orderBy: { occurredAt: 'asc' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    db.event.count({ where }),
  ]);

  return { data: rows.map(shape), total, page, pageSize };
}
