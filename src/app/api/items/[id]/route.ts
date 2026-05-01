import 'server-only';
import { getDb, itemRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, ok } from '@/lib/api/response';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id } = await params;
    const num = Number(id);
    if (!Number.isFinite(num)) return fail('NOT_FOUND', `bad id: ${id}`);

    const db = getDb(env.databaseUrl);
    const item = await itemRepo.getById(db, num);
    if (!item) return fail('NOT_FOUND', `item not found: ${id}`);
    return ok(item);
  } catch (err) {
    return failInternal(err);
  }
}
