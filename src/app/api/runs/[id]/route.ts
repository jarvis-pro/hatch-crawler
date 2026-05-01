import 'server-only';
import { getDb, runRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, ok } from '@/lib/api/response';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id } = await params;
    const db = getDb(env.databaseUrl);
    const run = await runRepo.getById(db, id);
    if (!run) return fail('NOT_FOUND', `run not found: ${id}`);
    return ok(run);
  } catch (err) {
    return failInternal(err);
  }
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id } = await params;
    const db = getDb(env.databaseUrl);
    const run = await runRepo.getById(db, id);
    if (!run) return fail('NOT_FOUND', `run not found: ${id}`);
    // 不允许删除运行中或排队中的 run，避免 worker 侧出现孤立 job
    if (run.status === 'running' || run.status === 'queued') {
      return fail('CONFLICT', `cannot delete run in status: ${run.status}，请先停止后再删除`);
    }
    await runRepo.remove(db, id);
    return ok({ deleted: id });
  } catch (err) {
    return failInternal(err);
  }
}
