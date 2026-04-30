import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, items, runs } from "@hatch-crawler/db";
import { env } from "@/lib/env";
import { failInternal, ok } from "@/lib/api/response";

export async function GET(): Promise<Response> {
  try {
    const db = getDb(env.databaseUrl);
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);

    const [
      runningRow,
      queuedRow,
      completed24Row,
      failed24Row,
      totalItemsRow,
      newItems24Row,
    ] = await Promise.all([
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(runs)
        .where(eq(runs.status, "running")),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(runs)
        .where(eq(runs.status, "queued")),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(runs)
        .where(
          and(eq(runs.status, "completed"), gte(runs.finishedAt, since24h)),
        ),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(runs)
        .where(and(eq(runs.status, "failed"), gte(runs.finishedAt, since24h))),
      db.select({ value: sql<number>`count(*)::int` }).from(items),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(items)
        .where(gte(items.fetchedAt, since24h)),
    ]);

    return ok({
      running: runningRow[0]?.value ?? 0,
      queued: queuedRow[0]?.value ?? 0,
      completed24h: completed24Row[0]?.value ?? 0,
      failed24h: failed24Row[0]?.value ?? 0,
      totalItems: totalItemsRow[0]?.value ?? 0,
      newItems24h: newItems24Row[0]?.value ?? 0,
    });
  } catch (err) {
    return failInternal(err);
  }
}
