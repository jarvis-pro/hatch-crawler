import 'server-only';
import { getDb, itemRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, ok } from '@/lib/api/response';

interface Ctx {
  params: Promise<{ id: string }>;
}

/** 简单 UUID 校验：8-4-4-4-12 hex */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return fail('NOT_FOUND', `bad id: ${id}`);

    const db = getDb(env.databaseUrl);
    const item = await itemRepo.getById(db, id);
    if (!item) return fail('NOT_FOUND', `item not found: ${id}`);
    return ok(item);
  } catch (err) {
    return failInternal(err);
  }
}
