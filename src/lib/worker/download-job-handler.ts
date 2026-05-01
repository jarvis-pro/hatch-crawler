import 'server-only';
import { type Db, attachmentRepo } from '@/lib/db';
import type { DownloadJobData } from '@/lib/db';
import type { AttachmentEvent } from '@/lib/shared';

import { downloadHttp } from '@/lib/downloads/http-fetcher';
import { downloadYtdlp } from '@/lib/downloads/ytdlp-fetcher';
import { getFileStorage } from '@/lib/storage/files';
import { withYoutubeHostLock } from './host-limits';
import { publishAttachment } from './event-bus';

/**
 * RFC 0002 Phase A：处理一个下载 job。
 *
 * 流程：
 *  1. 取 attachment 行（status=queued）
 *  2. markStarted → 派 'attach_started' 事件
 *  3. 按 fetcherKind 路由（A 期只有 'http'；C 期加 'yt-dlp'）
 *  4. 期间进度回调 → DB 节流写 + EventBus 实时推
 *  5. 完成 → markCompleted；失败 → markFailed；同时增量更新关联 run 的统计
 *
 * 抛错由 pg-boss 自己捕获按 retryLimit 重试。我们也主动捕获以保证 attachment 行被标 failed。
 */
export async function handleDownloadJob(
  db: Db,
  data: DownloadJobData,
  signal: AbortSignal,
): Promise<void> {
  const { attachmentId } = data;

  const attachment = await attachmentRepo.getById(db, attachmentId);
  if (!attachment) {
    // 行已被删；静默返回让 pg-boss 标完成
    return;
  }
  // 已经处理过了（重试到达），跳过
  if (attachment.status === 'completed') return;

  await attachmentRepo.markStarted(db, attachmentId);
  publish({ type: 'attach_started', attachmentId, at: Date.now() });

  // 关联 item 取 itemId 给 storage 路径用
  // attachment.itemId 已是 number
  // 关联 runId 可能没有（手动下载没 run），取自 item.runId
  let runId: string | null = null;
  try {
    const it = await db.item.findUnique({
      where: { id: attachment.itemId },
      select: { runId: true },
    });
    runId = it?.runId ?? null;
  } catch {
    // 找不到 item 也不阻断下载（手动派发时 item 必然存在）
  }

  // 进度节流：每 2 秒或 +5% 才写库；EventBus 每次都推
  let lastDbPct = -100;
  let lastDbTime = 0;

  const onProgress = (pct: number, bytes: number, totalBytes?: number, speedBps?: number): void => {
    publish({
      type: 'attach_progress',
      attachmentId,
      pct,
      bytes,
      totalBytes,
      speedBps,
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
    let result;
    const fetcherInput = {
      attachmentId,
      spider: attachment.spider,
      itemId: attachment.itemId,
      sourceUrl: attachment.sourceUrl,
    };
    if (attachment.fetcherKind === 'http') {
      result = await downloadHttp(fetcherInput, getFileStorage(), { signal, onProgress });
    } else if (attachment.fetcherKind === 'yt-dlp') {
      // YouTube 等站点 host 级限并发为 1（合规 + 防风控）
      result = await withYoutubeHostLock(attachment.sourceUrl, () =>
        downloadYtdlp(fetcherInput, getFileStorage(), { signal, onProgress }),
      );
    } else {
      throw new Error(`unsupported fetcherKind: ${attachment.fetcherKind}`);
    }

    // 内容去重：同 spider 已有相同 sha256 的 completed attachment，直接复用其 storagePath，
    // 删掉刚下载的临时文件以节省空间。
    const dup = await attachmentRepo.findBySha256(db, attachment.spider, result.sha256);
    if (dup && dup.id !== attachmentId && dup.storagePath) {
      // 删新写的、用旧的
      await getFileStorage().delete(result.storagePath);
      await attachmentRepo.markCompleted(db, attachmentId, {
        storagePath: dup.storagePath,
        byteSize: result.byteSize,
        sha256: result.sha256,
        mimeType: result.mimeType,
      });
    } else {
      await attachmentRepo.markCompleted(db, attachmentId, result);
    }

    publish({
      type: 'attach_completed',
      attachmentId,
      storagePath: result.storagePath,
      byteSize: result.byteSize,
      at: Date.now(),
    });

    if (runId) {
      void attachmentRepo.incrementRunStats(db, runId, { completed: 1 }).catch(() => {});
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await attachmentRepo.markFailed(db, attachmentId, message);
    publish({ type: 'attach_failed', attachmentId, error: message, at: Date.now() });
    if (runId) {
      void attachmentRepo.incrementRunStats(db, runId, { failed: 1 }).catch(() => {});
    }
    throw err;
  }

  function publish(event: AttachmentEvent): void {
    publishAttachment(attachmentId, event);
  }
}
