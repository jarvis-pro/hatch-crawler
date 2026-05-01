import 'server-only';
import { z } from 'zod';
import {
  AttachmentKind,
  AttachmentStatus,
  attachmentRepo,
  getBoss,
  getDb,
  QUEUE_TRANSCODE,
} from '@/lib/db';
import type { TranscodeJobData } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, failValidation, ok } from '@/lib/api/response';
import { publishAttachment } from '@/lib/worker/event-bus';

interface Ctx {
  params: Promise<{ id: string }>;
}

const schema = z.object({
  op: z.enum(['video_to_mp3']),
});

/**
 * POST /api/attachments/:id/transcode
 *
 * 派生一个新 attachment（kind=audio, parentId=src）并入 transcode 队列。
 * 当前只支持 video_to_mp3。
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id: srcId } = await params;
    const body = (await req.json()) as unknown;
    const parsed = schema.safeParse(body);
    if (!parsed.success) return failValidation(parsed.error);

    const db = getDb(env.databaseUrl);
    const src = await attachmentRepo.getById(db, srcId);
    if (!src) return fail('NOT_FOUND', `attachment not found: ${srcId}`);
    if (src.status !== AttachmentStatus.completed) {
      return fail('CONFLICT', `source attachment not ready: status=${String(src.status)}`);
    }
    if (src.kind !== AttachmentKind.video) {
      return fail('CONFLICT', `only video can be transcoded to mp3, got kind=${String(src.kind)}`);
    }

    // 创建派生 attachment
    const derived = await attachmentRepo.create(db, {
      itemId: src.itemId,
      spider: src.spider,
      kind: AttachmentKind.audio,
      sourceUrl: src.sourceUrl,
      fetcherKind: 'http', // 转码后的派生不再走外部 fetcher，只是占位
      mimeType: 'audio/mpeg',
      parentId: src.id,
      transcodeOp: parsed.data.op,
    });

    publishAttachment(derived.id, {
      type: 'attach_queued',
      attachmentId: derived.id,
      at: Date.now(),
    });

    const { boss, ready } = getBoss(env.databaseUrl);
    await ready;
    await boss.send(QUEUE_TRANSCODE, { attachmentId: derived.id } satisfies TranscodeJobData);

    return ok(derived);
  } catch (err) {
    return failInternal(err);
  }
}
