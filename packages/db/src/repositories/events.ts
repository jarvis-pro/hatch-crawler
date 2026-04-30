import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { events, type Event, type EventLevel } from "../schema.js";

export interface AppendEventInput {
  runId: string;
  level: EventLevel;
  type: string;
  message?: string;
  payload?: Record<string, unknown>;
}

export async function append(db: Db, input: AppendEventInput): Promise<void> {
  await db.insert(events).values({
    runId: input.runId,
    level: input.level,
    type: input.type,
    message: input.message ?? null,
    payload: input.payload ?? {},
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

  const where = and(
    eq(events.runId, params.runId),
    params.level ? eq(events.level, params.level) : undefined,
  );

  const data = await db
    .select()
    .from(events)
    .where(where)
    .orderBy(asc(events.occurredAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [c] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(events)
    .where(where);

  return { data, total: c?.value ?? 0, page, pageSize };
}
