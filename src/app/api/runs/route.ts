import 'server-only';
import { z } from 'zod';
import { getBoss, getDb, QUEUE_CRAWL, runRepo, spiderRepo, type RunStatus } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, failValidation, ok } from '@/lib/api/response';

const createSchema = z.object({
  /** spiders.id UUID */
  spiderId: z.string().uuid(),
  overrides: z.record(z.unknown()).default({}),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as unknown;
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return failValidation(parsed.error);

    const db = getDb(env.databaseUrl);
    const spider = await spiderRepo.getById(db, parsed.data.spiderId);
    if (!spider) return fail('NOT_FOUND', `spider not found: ${parsed.data.spiderId}`);
    if (!spider.enabled) return fail('CONFLICT', `spider disabled: ${spider.name}`);

    const run = await runRepo.create(db, {
      spiderId: spider.id,
      spiderName: spider.name,
      triggerType: 'manual',
      overrides: parsed.data.overrides,
    });

    const { boss, ready } = getBoss(env.databaseUrl);
    await ready;
    await boss.send(QUEUE_CRAWL, {
      runId: run.id,
      spiderId: spider.id,
      overrides: parsed.data.overrides,
    });

    return ok({ id: run.id });
  } catch (err) {
    return failInternal(err);
  }
}

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const spiderId = url.searchParams.get('spiderId') ?? undefined;
    const statusParam = url.searchParams.get('status');
    const status = statusParam ? (statusParam.split(',') as RunStatus[]) : undefined;
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');

    const db = getDb(env.databaseUrl);
    const result = await runRepo.list(db, {
      spiderId,
      status,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 20,
    });
    return ok(result);
  } catch (err) {
    return failInternal(err);
  }
}

/**
 * DELETE /api/runs
 * Body: { ids: string[] }
 * 批量删除终态（completed / failed / stopped）的运行记录；
 * running / queued 状态的记录会被自动跳过，不报错。
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
      .map(String)
      .filter((s) => s.length > 0);

    if (ids.length === 0) return fail('VALIDATION_ERROR', 'ids array is empty or invalid');

    const db = getDb(env.databaseUrl);
    const deleted = await runRepo.removeMany(db, ids);
    return ok({ deleted });
  } catch (err) {
    return failInternal(err);
  }
}
