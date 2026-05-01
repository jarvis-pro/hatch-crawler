import 'server-only';
import path from 'node:path';
import { type Db, attachmentRepo, AttachmentStatus } from '@/lib/db';
import { videoToMp3 } from '@/lib/downloads/ffmpeg-runner';
import { buildAttachmentPath } from '@/lib/storage/files';
import { env } from '@/lib/env';
import { publishAttachment } from './event-bus';

/**
 * RFC 0002 Phase B：转码 job。
 *
 * 入参 attachmentId 必须指向一个**派生**附件行（已在 API 层创建好，status=queued，
 * parentId 指向源视频附件，transcodeOp='video_to_mp3'）。
 *
 * handler 的工作：
 *   1. 找到 src（parent）拿源文件路径
 *   2. ffmpeg 转 mp3 到派生附件的目标路径
 *   3. 进度上报 → DB 节流 + EventBus 实时
 *   4. mark completed / failed
 */
export interface TranscodeJobData {
  attachmentId: string;
}

export async function handleTranscodeJob(
  db: Db,
  data: TranscodeJobData,
  signal: AbortSignal,
): Promise<void> {
  const { attachmentId } = data;

  const derived = await attachmentRepo.getById(db, attachmentId);
  if (!derived) return; // 行已删
  if (derived.status === AttachmentStatus.completed) return;

  if (!derived.parentId) {
    await attachmentRepo.markFailed(db, attachmentId, 'transcode attachment missing parentId');
    return;
  }
  const src = await attachmentRepo.getById(db, derived.parentId);
  if (!src || !src.storagePath || src.status !== AttachmentStatus.completed) {
    await attachmentRepo.markFailed(db, attachmentId, 'source attachment not ready for transcode');
    return;
  }

  // mark started + 公布事件
  await db.attachment.update({
    where: { id: attachmentId },
    data: { status: AttachmentStatus.transcoding, startedAt: new Date(), progressPct: 0 },
  });
  publishAttachment(attachmentId, { type: 'attach_started', attachmentId, at: Date.now() });

  // 派生文件路径
  const dstRel = buildAttachmentPath({
    spider: derived.spider,
    itemId: derived.itemId,
    attachmentId,
    ext: 'mp3',
  });
  const root = env.storageLocalRoot;
  const srcAbs = path.resolve(root, src.storagePath);
  const dstAbs = path.resolve(root, dstRel);

  let lastDbPct = -100;
  let lastDbTime = 0;
  const onProgress = (pct: number): void => {
    publishAttachment(attachmentId, {
      type: 'attach_progress',
      attachmentId,
      pct,
      bytes: 0,
      at: Date.now(),
    });
    const now = Date.now();
    if (pct - lastDbPct >= 5 || now - lastDbTime >= 2000) {
      lastDbPct = pct;
      lastDbTime = now;
      void attachmentRepo.updateProgress(db, attachmentId, pct).catch(() => {});
    }
  };

  try {
    const result = await videoToMp3(srcAbs, dstAbs, { signal, onProgress });
    await attachmentRepo.markCompleted(db, attachmentId, {
      storagePath: dstRel,
      byteSize: result.byteSize,
      sha256: result.sha256,
      mimeType: 'audio/mpeg',
    });
    publishAttachment(attachmentId, {
      type: 'attach_completed',
      attachmentId,
      storagePath: dstRel,
      byteSize: result.byteSize,
      at: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await attachmentRepo.markFailed(db, attachmentId, message);
    publishAttachment(attachmentId, {
      type: 'attach_failed',
      attachmentId,
      error: message,
      at: Date.now(),
    });
    throw err;
  }
}
