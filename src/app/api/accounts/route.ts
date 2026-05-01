import 'server-only';
import { z } from 'zod';
import { getDb, accountRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { failInternal, failValidation, ok } from '@/lib/api/response';

const CreateSchema = z.object({
  platform: z.string().min(1).max(32),
  label: z.string().min(1).max(64),
  kind: z.enum(['cookie', 'oauth', 'apikey', 'session']),
  payload: z.string().min(1),
  expiresAt: z.string().datetime().optional().nullable(),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const platform = url.searchParams.get('platform') ?? undefined;
    const db = getDb(env.databaseUrl);
    const rows = await accountRepo.listByPlatform(db, platform);
    return ok(rows);
  } catch (err) {
    return failInternal(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as unknown;
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) return failValidation(parsed.error);

    const db = getDb(env.databaseUrl);
    const row = await accountRepo.create(
      db,
      {
        platform: parsed.data.platform,
        label: parsed.data.label,
        kind: parsed.data.kind,
        payload: parsed.data.payload,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      },
      env.accountsMasterKey,
    );
    return ok(row, { status: 201 });
  } catch (err) {
    return failInternal(err);
  }
}
