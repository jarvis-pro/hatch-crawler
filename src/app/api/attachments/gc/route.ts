import 'server-only';
import { z } from 'zod';
import { AttachmentStatus, getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { failInternal, failValidation, ok } from '@/lib/api/response';
import { getFileStorage } from '@/lib/storage/files';

const schema = z.object({
  /** 删除 N 天前的 failed 行；默认 7 天 */
  olderThanDays: z.number().int().min(0).max(365).default(7),
});

/**
 * POST /api/attachments/gc
 *
 * 一键回收：删除指定天数前所有 status=failed 的 attachment 行（含磁盘文件，如果有的话）。
 * 用于看板「清理失败下载」按钮。
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as unknown;
    const parsed = schema.safeParse(body);
    if (!parsed.success) return failValidation(parsed.error);
    const { olderThanDays } = parsed.data;

    const db = getDb(env.databaseUrl);
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60_000);

    const failed = await db.attachment.findMany({
      where: { status: AttachmentStatus.failed, createdAt: { lt: cutoff } },
      select: { id: true, storagePath: true },
    });

    const storage = getFileStorage();
    for (const a of failed) {
      if (a.storagePath) {
        await storage.delete(a.storagePath).catch(() => undefined);
      }
    }

    const r = await db.attachment.deleteMany({
      where: { status: AttachmentStatus.failed, createdAt: { lt: cutoff } },
    });

    return ok({ deleted: r.count, olderThanDays });
  } catch (err) {
    return failInternal(err);
  }
}
