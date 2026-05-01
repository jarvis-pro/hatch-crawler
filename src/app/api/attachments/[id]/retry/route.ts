import 'server-only';
import {
  AttachmentStatus,
  attachmentRepo,
  getBoss,
  getDb,
  QUEUE_DOWNLOAD,
  QUEUE_TRANSCODE,
} from '@/lib/db';
import type { DownloadJobData, TranscodeJobData } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, ok } from '@/lib/api/response';
import { publishAttachment } from '@/lib/worker/event-bus';

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/attachments/:id/retry
 *
 * 把失败的 attachment 重置为 queued 并重新入队（http / yt-dlp / transcode 三类都支持）。
 */
export async function POST(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id } = await params;
    const db = getDb(env.databaseUrl);
    const att = await attachmentRepo.getById(db, id);
    if (!att) return fail('NOT_FOUND', `attachment not found: ${id}`);
    if (att.status !== AttachmentStatus.failed) {
      return fail(
        'CONFLICT',
        `only failed attachments can be retried, status=${String(att.status)}`,
      );
    }

    // 重置状态
    await db.attachment.update({
      where: { id },
      data: {
        status: AttachmentStatus.queued,
        progressPct: null,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
      },
    });
    publishAttachment(id, { type: 'attach_queued', attachmentId: id, at: Date.now() });

    // 派回对应队列：转码产物（parentId 不为 null）走 transcode，其它走 download
    const { boss, ready } = getBoss(env.databaseUrl);
    await ready;
    if (att.parentId) {
      await boss.send(QUEUE_TRANSCODE, { attachmentId: id } satisfies TranscodeJobData);
    } else {
      await boss.send(QUEUE_DOWNLOAD, { attachmentId: id } satisfies DownloadJobData);
    }

    return ok({ retried: true });
  } catch (err) {
    return failInternal(err);
  }
}
