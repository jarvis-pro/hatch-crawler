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
