import 'server-only';
import { getDb, itemRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { failInternal, ok } from '@/lib/api/response';

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const spider = url.searchParams.get('spider') ?? undefined;
    const type = url.searchParams.get('type') ?? undefined;
    const runId = url.searchParams.get('runId') ?? undefined;
    const q = url.searchParams.get('q') ?? undefined;
    const platform = url.searchParams.get('platform') ?? undefined;
    const kind = url.searchParams.get('kind') ?? undefined;
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');

    const db = getDb(env.databaseUrl);
    const result = await itemRepo.list(db, {
      spider,
      type,
      runId,
      q,
      platform,
      kind,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    });
    return ok(result);
  } catch (err) {
    return failInternal(err);
  }
}
