import 'server-only';
import { getDb, accountRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, ok } from '@/lib/api/response';
import { z } from 'zod';

const patchSchema = z.object({
  action: z.literal('unban'),
});

/** PATCH /api/accounts/:id — 目前只支持 { action: "unban" }，将账号恢复为 active */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const accountId = Number(id);
    if (!Number.isFinite(accountId)) return fail('VALIDATION_ERROR', 'invalid id');

    const body: unknown = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return fail('VALIDATION_ERROR', parsed.error.message);

    const db = getDb(env.databaseUrl);
    await accountRepo.resetStatus(db, accountId);
    return ok({ unbanned: true });
  } catch (err) {
    return failInternal(err);
  }
}

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
