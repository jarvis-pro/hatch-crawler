import 'server-only';
import { attachmentRepo, getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, ok } from '@/lib/api/response';
import { getFileStorage } from '@/lib/storage/files';

interface Ctx {
  params: Promise<{ id: string }>;
}

/** GET /api/attachments/:id — 取单条 attachment 详情（含状态/进度/错误）*/
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id } = await params;
    const db = getDb(env.databaseUrl);
    const attachment = await attachmentRepo.getById(db, id);
    if (!attachment) return fail('NOT_FOUND', `attachment not found: ${id}`);
    return ok(attachment);
  } catch (err) {
    return failInternal(err);
  }
}

/** DELETE /api/attachments/:id — 删除文件 + 数据库行（不影响其他派生 attachment）*/
export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id } = await params;
    const db = getDb(env.databaseUrl);
    const removed = await attachmentRepo.deleteById(db, id);
    if (!removed) return fail('NOT_FOUND', `attachment not found: ${id}`);

    // 删盘上的文件（非阻塞，失败也不回滚 DB 删）
    if (removed.storagePath) {
      void getFileStorage()
        .delete(removed.storagePath)
        .catch(() => {});
    }
    return ok({ deleted: true });
  } catch (err) {
    return failInternal(err);
  }
}
