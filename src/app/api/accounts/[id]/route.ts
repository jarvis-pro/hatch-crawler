import 'server-only';
import { getDb, accountRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, ok } from '@/lib/api/response';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const accountId = Number(id);
    if (!Number.isFinite(accountId)) return fail('VALIDATION_ERROR', 'invalid id');
    const db = getDb(env.databaseUrl);
    await accountRepo.remove(db, accountId);
    return ok({ deleted: true });
  } catch (err) {
    return failInternal(err);
  }
}
