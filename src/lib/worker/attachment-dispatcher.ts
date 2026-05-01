import 'server-only';
import {
  AttachmentKind,
  attachmentRepo,
  getBoss,
  type Db,
  type Item,
  QUEUE_DOWNLOAD,
  settingRepo,
} from '@/lib/db';
import type { DownloadJobData } from '@/lib/db';
import { env } from '@/lib/env';
import { publishAttachment } from './event-bus';
import { isYoutubeUrl } from './host-limits';

/**
 * RFC 0002 Phase D —— autoDownload 与手动批量派发的共用逻辑。
 *
 * 给定一个 item，决定要派发多少 attachment 下载 job：
 *  1. 扫 payload.media[]：kind ∈ {video, audio, image, thumbnail} 且 url 存在 → http 下载
 *  2. 若 platform=youtube 且 kind=video 且全局允许 yt-dlp：对 item.url 派 yt-dlp
 *
 * 已存在相同 (itemId, sourceUrl, fetcherKind) 的 attachment 跳过（幂等）。
 */

export interface DispatchOptions {
  /** 全局是否允许 yt-dlp（即 settings.enable_youtube_download === true） */
  allowYoutube: boolean;
}

interface MediaEntry {
  kind?: string;
  url?: string;
  mime?: string;
}

interface PlanEntry {
  sourceUrl: string;
  kind: AttachmentKind;
  fetcherKind: 'http' | 'yt-dlp';
  mimeType: string | null;
}

const MEDIA_TO_ATTACHMENT: Record<string, AttachmentKind> = {
  video: AttachmentKind.video,
  audio: AttachmentKind.audio,
  image: AttachmentKind.image,
  thumbnail: AttachmentKind.image,
};

function planForItem(item: Item, options: DispatchOptions): PlanEntry[] {
  const plans: PlanEntry[] = [];

  const payload = (item.payload ?? {}) as { media?: MediaEntry[] };
  for (const m of payload.media ?? []) {
    if (!m.url || typeof m.url !== 'string') continue;
    const ak = MEDIA_TO_ATTACHMENT[m.kind ?? ''];
    if (!ak) continue;
    plans.push({
      sourceUrl: m.url,
      kind: ak,
      fetcherKind: 'http',
      mimeType: m.mime ?? null,
    });
  }

  // YouTube 视频本体：API 不返回播放 URL，只能 yt-dlp 抓 item.url
  if (
    options.allowYoutube &&
    item.platform === 'youtube' &&
    item.kind === 'video' &&
    isYoutubeUrl(item.url)
  ) {
    plans.push({
      sourceUrl: item.url,
      kind: AttachmentKind.video,
      fetcherKind: 'yt-dlp',
      mimeType: null,
    });
  }

  return plans;
}

/**
 * 给单个 item 派发所有可能的下载。
 * 返回新入队数量；已存在的 attachment 不重复入队。
 */
export async function dispatchForItem(
  db: Db,
  item: Item,
  options: DispatchOptions,
): Promise<{ queued: number; skipped: number }> {
  const plans = planForItem(item, options);
  let queued = 0;
  let skipped = 0;

  for (const plan of plans) {
    // 幂等：同 itemId + sourceUrl + fetcherKind 已存在则跳过
    const existing = await db.attachment.findFirst({
      where: { itemId: item.id, sourceUrl: plan.sourceUrl, fetcherKind: plan.fetcherKind },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    // 配额检查（RFC 0002 D-5）：超出 STORAGE_MAX_GB 不再入队
    if (await isStorageOverQuota(db)) {
      throw new Error(
        `存储用量已超过 STORAGE_MAX_GB=${String(env.storageMaxGB)}，新下载已暂停。请在 /attachments 清理或调高配额。`,
      );
    }

    const attachment = await attachmentRepo.create(db, {
      itemId: item.id,
      spider: item.spider,
      kind: plan.kind,
      sourceUrl: plan.sourceUrl,
      fetcherKind: plan.fetcherKind,
      mimeType: plan.mimeType,
    });
    publishAttachment(attachment.id, {
      type: 'attach_queued',
      attachmentId: attachment.id,
      at: Date.now(),
    });

    const { boss, ready } = getBoss(env.databaseUrl);
    await ready;
    await boss.send(QUEUE_DOWNLOAD, { attachmentId: attachment.id } satisfies DownloadJobData);
    queued++;
  }

  if (queued > 0 && item.runId) {
    void attachmentRepo.incrementRunStats(db, item.runId, { queued }).catch(() => {});
  }
  return { queued, skipped };
}

/** 一次性给 run 下所有 item 派发下载（autoDownload 自动模式 + /download-all 手动模式共用）。 */
export async function dispatchForRun(
  db: Db,
  runId: string,
  options: DispatchOptions,
): Promise<{ items: number; queued: number; skipped: number; errors: number }> {
  const itemsRaw = await db.item.findMany({ where: { runId }, take: 1000 });
  let queued = 0;
  let skipped = 0;
  let errors = 0;

  for (const raw of itemsRaw) {
    const item = {
      ...raw,
      payload: raw.payload as Record<string, unknown>,
    } as Item;
    try {
      const r = await dispatchForItem(db, item, options);
      queued += r.queued;
      skipped += r.skipped;
    } catch {
      errors++;
    }
  }

  return { items: itemsRaw.length, queued, skipped, errors };
}

/** 读 settings.enable_youtube_download；缺/false 都返回 false。 */
export async function isYoutubeDownloadEnabled(db: Db): Promise<boolean> {
  const v = await settingRepo.get<boolean>(db, 'enable_youtube_download').catch(() => null);
  return Boolean(v);
}

/**
 * RFC 0002 D-5：存储配额检查。
 * 当前用量 = SUM(byte_size) FROM attachments WHERE status='completed'
 * 超过 env.storageMaxGB 时返回 true（拒绝新下载入队）。
 */
export async function isStorageOverQuota(db: Db): Promise<boolean> {
  if (env.storageMaxGB <= 0) return false; // 0/负数表示不限制
  const rows = await db.$queryRawUnsafe<{ used: bigint | null }[]>(
    `SELECT COALESCE(SUM("byte_size"), 0)::bigint AS used FROM "attachments" WHERE "status" = 'completed'`,
  );
  const used = Number(rows[0]?.used ?? 0n);
  return used > env.storageMaxGB * 1024 * 1024 * 1024;
}
