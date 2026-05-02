import 'server-only';
import { getDb, itemRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, ok } from '@/lib/api/response';

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const spider = url.searchParams.get('spider') ?? undefined;
    const type = url.searchParams.get('type') ?? undefined;
    const runId = url.searchParams.get('runId') ?? undefined;
    const q = url.searchParams.get('q') ?? undefined;
    const platform = url.searchParams.get('platform') ?? undefined;
    const kind = url.searchParams.get('kind') ?? undefined;
    const triggerKind = url.searchParams.get('triggerKind') ?? undefined;
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
      triggerKind,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    });
    return ok(result);
  } catch (err) {
    return failInternal(err);
  }
}

/**
 * DELETE /api/items
 * Body: { ids: number[] }
 * 批量删除指定 id 的条目。
 */
export async function DELETE(req: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail('VALIDATION_ERROR', 'request body must be JSON');
    }

    if (
      typeof body !== 'object' ||
      body === null ||
      !Array.isArray((body as Record<string, unknown>).ids)
    ) {
      return fail('VALIDATION_ERROR', 'body must contain ids array');
    }

    const ids = ((body as Record<string, unknown>).ids as unknown[])
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);

    if (ids.length === 0) return fail('VALIDATION_ERROR', 'ids array is empty or invalid');

    const db = getDb(env.databaseUrl);
    const deleted = await itemRepo.deleteMany(db, ids);
    return ok({ deleted });
  } catch (err) {
    return failInternal(err);
  }
}
