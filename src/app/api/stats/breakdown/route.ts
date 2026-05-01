import 'server-only';
import { getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { failInternal, ok } from '@/lib/api/response';

export interface BreakdownRow {
  label: string;
  count: number;
}

export interface BreakdownResult {
  byPlatform: BreakdownRow[];
  byKind: BreakdownRow[];
}

/**
 * GET /api/stats/breakdown
 *
 * 返回 items 按平台 / kind 的聚合计数。
 * 用于 Dashboard 跨平台对比图表。
 */
export async function GET(): Promise<Response> {
  try {
    const db = getDb(env.databaseUrl);

    const [platformRows, kindRows] = await Promise.all([
      db.$queryRaw<{ label: string; count: bigint }[]>`
        SELECT COALESCE(platform, '未知') AS label, COUNT(*)::bigint AS count
        FROM items
        GROUP BY platform
        ORDER BY count DESC
        LIMIT 20
      `,
      db.$queryRaw<{ label: string; count: bigint }[]>`
        SELECT COALESCE(kind, '未知') AS label, COUNT(*)::bigint AS count
        FROM items
        GROUP BY kind
        ORDER BY count DESC
        LIMIT 20
      `,
    ]);

    // bigint → number（前端 JSON 可序列化）
    const toRows = (rows: { label: string; count: bigint }[]): BreakdownRow[] =>
      rows.map((r) => ({ label: r.label, count: Number(r.count) }));

    return ok<BreakdownResult>({
      byPlatform: toRows(platformRows),
      byKind: toRows(kindRows),
    });
  } catch (err) {
    return failInternal(err);
  }
}
