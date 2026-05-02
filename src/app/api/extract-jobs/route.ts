import 'server-only';
import { z } from 'zod';
import { extractJobRepo, getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { failInternal, failValidation, ok } from '@/lib/api/response';

/**
 * GET /api/extract-jobs?page=1&pageSize=20&status=running|completed
 *
 * /extract 页历史记录区使用：按 created_at desc 分页列出快取批次。
 */

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['running', 'completed']).optional(),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));
    if (!parsed.success) return failValidation(parsed.error);

    const db = getDb(env.databaseUrl);
    const result = await extractJobRepo.list(db, parsed.data);
    return ok(result);
  } catch (err) {
    return failInternal(err);
  }
}
