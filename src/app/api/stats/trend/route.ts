import 'server-only';
import { getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { failInternal, ok } from '@/lib/api/response';

export interface TrendPoint {
  date: string; // "YYYY-MM-DD"
  count: number;
}

/**
 * GET /api/stats/trend?days=7
 *
 * 返回最近 N 天每天新增 items 数量。
 * 缺失日期自动填 0，保证前端图表连续。
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const days = Math.min(Math.max(Number(url.searchParams.get('days') ?? '7'), 1), 90);
    const spiderId = url.searchParams.get('spiderId') ?? null;

    const db = getDb(env.databaseUrl);

    let rows: { date: Date; count: bigint }[];
    if (spiderId) {
      rows = await db.$queryRawUnsafe<{ date: Date; count: bigint }[]>(
        `SELECT
          DATE_TRUNC('day', i.fetched_at AT TIME ZONE 'UTC')::date AS date,
          COUNT(*)::bigint AS count
        FROM items i
        JOIN runs r ON i.run_id = r.id
        WHERE i.fetched_at >= NOW() - ($1 || ' days')::interval
          AND r.spider_id = $2::uuid
        GROUP BY DATE_TRUNC('day', i.fetched_at AT TIME ZONE 'UTC')::date
        ORDER BY date ASC`,
        String(days),
        spiderId,
      );
    } else {
      rows = await db.$queryRaw<{ date: Date; count: bigint }[]>`
        SELECT
          DATE_TRUNC('day', fetched_at AT TIME ZONE 'UTC')::date AS date,
          COUNT(*)::bigint AS count
        FROM items
        WHERE fetched_at >= NOW() - (${days} || ' days')::interval
        GROUP BY DATE_TRUNC('day', fetched_at AT TIME ZONE 'UTC')::date
        ORDER BY date ASC
      `;
    }

    // 构建完整日期序列，缺失日填 0
    const map = new Map<string, number>(
      rows.map((r) => [r.date.toISOString().slice(0, 10), Number(r.count)]),
    );

    const points: TrendPoint[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      points.push({ date: key, count: map.get(key) ?? 0 });
    }

    return ok<TrendPoint[]>(points);
  } catch (err) {
    return failInternal(err);
  }
}
