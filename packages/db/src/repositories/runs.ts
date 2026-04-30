import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import {
  runs,
  type NewRun,
  type Run,
  type RunStatus,
} from "../schema.js";

export interface CreateRunInput {
  spiderName: string;
  triggerType: "manual" | "cron";
  overrides?: Record<string, unknown>;
}

export async function create(
  db: Db,
  input: CreateRunInput,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(runs)
    .values({
      spiderName: input.spiderName,
      triggerType: input.triggerType,
      overrides: input.overrides ?? {},
    } satisfies NewRun)
    .returning({ id: runs.id });
  return { id: row!.id };
}

export async function getById(db: Db, id: string): Promise<Run | null> {
  const rows = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function markStarted(db: Db, id: string): Promise<void> {
  await db
    .update(runs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(runs.id, id));
}

export async function markFinished(
  db: Db,
  id: string,
  status: "completed" | "failed" | "stopped",
  errorMessage?: string,
): Promise<void> {
  await db
    .update(runs)
    .set({
      status,
      finishedAt: new Date(),
      errorMessage: errorMessage ?? null,
    })
    .where(eq(runs.id, id));
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
  const updates: Record<string, unknown> = {};
  if (delta.fetched)
    updates.fetched = sql`${runs.fetched} + ${delta.fetched}`;
  if (delta.emitted)
    updates.emitted = sql`${runs.emitted} + ${delta.emitted}`;
  if (delta.newItems)
    updates.newItems = sql`${runs.newItems} + ${delta.newItems}`;
  if (delta.errors) updates.errors = sql`${runs.errors} + ${delta.errors}`;
  if (Object.keys(updates).length === 0) return;
  await db.update(runs).set(updates).where(eq(runs.id, id));
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

  const conditions = [];
  if (params.spider) conditions.push(eq(runs.spiderName, params.spider));
  if (params.status) {
    const arr = Array.isArray(params.status) ? params.status : [params.status];
    conditions.push(inArray(runs.status, arr));
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const data = await db
    .select()
    .from(runs)
    .where(where)
    .orderBy(desc(runs.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [c] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(runs)
    .where(where);

  return { data, total: c?.value ?? 0, page, pageSize };
}

/**
 * 启动时清理：把状态仍是 running 但很久没更新的 run 标记为 failed。
 *
 * 触发场景：上次 web 进程异常退出，DB 里留下假的 running 记录。
 */
export async function cleanupStale(
  db: Db,
  staleAfterMin = 30,
): Promise<number> {
  const threshold = new Date(Date.now() - staleAfterMin * 60_000);
  const rows = await db
    .update(runs)
    .set({
      status: "failed",
      finishedAt: new Date(),
      errorMessage: "stale: marked failed by startup cleanup",
    })
    .where(and(eq(runs.status, "running"), lt(runs.startedAt, threshold)))
    .returning({ id: runs.id });
  return rows.length;
}
