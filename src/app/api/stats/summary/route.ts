import 'server-only';
import { RunStatus } from '@prisma/client';
import { getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { failInternal, ok } from '@/lib/api/response';

export async function GET(): Promise<Response> {
  try {
    const db = getDb(env.databaseUrl);
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);

    const [running, queued, completed24h, failed24h, totalItems, newItems24h] = await Promise.all([
      db.run.count({ where: { status: RunStatus.running } }),
      db.run.count({ where: { status: RunStatus.queued } }),
      db.run.count({
        where: {
          status: RunStatus.completed,
          finishedAt: { gte: since24h },
        },
      }),
      db.run.count({
        where: {
          status: RunStatus.failed,
          finishedAt: { gte: since24h },
        },
      }),
      db.item.count(),
      db.item.count({ where: { fetchedAt: { gte: since24h } } }),
    ]);

    return ok({
      running,
      queued,
      completed24h,
      failed24h,
      totalItems,
      newItems24h,
    });
  } catch (err) {
    return failInternal(err);
  }
}
