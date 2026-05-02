import 'server-only';
import { extractJobRepo, getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, ok } from '@/lib/api/response';

/**
 * GET /api/extract-jobs/:id
 *
 * 返回 extract_job 详情 + 已完成的 items 列表。
 * 前端在历史区点开任一记录展开时调用；运行中的批次也用此端点轮询进度。
 */

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!id) return fail('VALIDATION_ERROR', '缺少 id');

    const db = getDb(env.databaseUrl);
    const job = await extractJobRepo.getById(db, id);
    if (!job) return fail('NOT_FOUND', `extract_job not found: ${id}`);

    // 拉出关联 items（按 fetched_at desc，单批最多也就几十条）
    const items = await db.item.findMany({
      where: { extractJobId: id },
      orderBy: { fetchedAt: 'desc' },
      take: 100,
    });

    return ok({
      job,
      items: items.map((row) => ({
        ...row,
        payload: row.payload as Record<string, unknown>,
      })),
    });
  } catch (err) {
    return failInternal(err);
  }
}

/**
 * DELETE /api/extract-jobs/:id
 *
 * 仅允许删除已完成的批次；正在跑的不让删（避免 worker 写孤悬 outcome）。
 * items.extract_job_id 由 ON DELETE SET NULL 保留 item 行，不会丢数据。
 */
export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await context.params;
    if (!id) return fail('VALIDATION_ERROR', '缺少 id');

    const db = getDb(env.databaseUrl);
    const deleted = await extractJobRepo.removeMany(db, [id]);
    if (deleted === 0) {
      return fail('CONFLICT', '记录不存在或仍在运行中');
    }
    return ok({ deleted });
  } catch (err) {
    return failInternal(err);
  }
}
