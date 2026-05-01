import 'server-only';
import { z } from 'zod';
import { AttachmentKind, attachmentRepo, getBoss, getDb, itemRepo, QUEUE_DOWNLOAD } from '@/lib/db';
import type { DownloadJobData } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, failValidation, ok } from '@/lib/api/response';
import { publishAttachment } from '@/lib/worker/event-bus';

interface Ctx {
  params: Promise<{ id: string }>;
}

/** GET /api/items/:id/attachments — 列出某 item 的全部 attachments */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id } = await params;
    const num = Number(id);
    if (!Number.isFinite(num)) return fail('NOT_FOUND', `bad item id: ${id}`);

    const db = getDb(env.databaseUrl);
    const item = await itemRepo.getById(db, num);
    if (!item) return fail('NOT_FOUND', `item not found: ${id}`);

    const list = await attachmentRepo.listByItem(db, num);
    return ok(list);
  } catch (err) {
    return failInternal(err);
  }
}

const createSchema = z.object({
  url: z.string().url(),
  kind: z.nativeEnum(AttachmentKind),
  fetcherKind: z.enum(['http', 'yt-dlp']).default('http'),
  mimeType: z.string().max(128).nullish(),
});

/** POST /api/items/:id/attachments — 派发一个新下载（手动触发） */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id } = await params;
    const num = Number(id);
    if (!Number.isFinite(num)) return fail('NOT_FOUND', `bad item id: ${id}`);

    const body = (await req.json()) as unknown;
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return failValidation(parsed.error);

    const db = getDb(env.databaseUrl);
    const item = await itemRepo.getById(db, num);
    if (!item) return fail('NOT_FOUND', `item not found: ${id}`);

    const attachment = await attachmentRepo.create(db, {
      itemId: num,
      spider: item.spider,
      kind: parsed.data.kind,
      sourceUrl: parsed.data.url,
      fetcherKind: parsed.data.fetcherKind,
      mimeType: parsed.data.mimeType ?? null,
    });

    // 派 'attach_queued' 事件供 UI 即时显示；DB 已是 status=queued
    publishAttachment(attachment.id, {
      type: 'attach_queued',
      attachmentId: attachment.id,
      at: Date.now(),
    });

    // 入 download 队列
    const { boss, ready } = getBoss(env.databaseUrl);
    await ready;
    await boss.send(QUEUE_DOWNLOAD, { attachmentId: attachment.id } satisfies DownloadJobData);

    // 关联 run 的统计 +1
    if (item.runId) {
      void attachmentRepo.incrementRunStats(db, item.runId, { queued: 1 }).catch(() => {});
    }

    return ok(attachment);
  } catch (err) {
    return failInternal(err);
  }
}
