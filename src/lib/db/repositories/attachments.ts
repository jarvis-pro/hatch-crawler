import { type Prisma, AttachmentStatus } from '@prisma/client';
import type { Db } from '../client';
import type { Attachment, NewAttachment } from '../index';

/**
 * Attachments 仓储 —— RFC 0002 Phase A
 *
 * Item 与文件多对多分离。一行 attachment 表示"这个 item 的某个文件副本"，
 * 可能是原始下载（parent_id = null）或派生转码（parent_id 指向源 attachment）。
 */

function shape(row: { byteSize: bigint | null; [k: string]: unknown }): Attachment {
  return {
    ...row,
    byteSize: row.byteSize === null ? null : Number(row.byteSize),
  } as Attachment;
}

export async function create(db: Db, input: NewAttachment): Promise<Attachment> {
  const row = await db.attachment.create({
    data: {
      itemId: input.itemId,
      spider: input.spider,
      kind: input.kind,
      sourceUrl: input.sourceUrl,
      fetcherKind: input.fetcherKind,
      mimeType: input.mimeType ?? null,
      parentId: input.parentId ?? null,
      transcodeOp: input.transcodeOp ?? null,
      status: AttachmentStatus.queued,
    },
  });
  return shape(row);
}

export async function getById(db: Db, id: string): Promise<Attachment | null> {
  const row = await db.attachment.findUnique({ where: { id } });
  return row ? shape(row) : null;
}

export async function listByItem(db: Db, itemId: number): Promise<Attachment[]> {
  // 按创建时间升序：派生（转码产物）总是在源之后入队，
  // 自然形成"父在前、派生紧随其后"的可读顺序，前端按 parentId 缩进展示。
  const rows = await db.attachment.findMany({
    where: { itemId },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map(shape);
}

export interface ListParams {
  spider?: string;
  status?: AttachmentStatus | AttachmentStatus[];
  page?: number;
  pageSize?: number;
}

export async function list(
  db: Db,
  params: ListParams = {},
): Promise<{ data: Attachment[]; total: number; page: number; pageSize: number }> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;

  const where: Prisma.AttachmentWhereInput = {};
  if (params.spider) where.spider = params.spider;
  if (params.status) {
    where.status = Array.isArray(params.status) ? { in: params.status } : params.status;
  }

  const [rows, total] = await Promise.all([
    db.attachment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    db.attachment.count({ where }),
  ]);

  return { data: rows.map(shape), total, page, pageSize };
}

export async function markStarted(db: Db, id: string): Promise<void> {
  await db.attachment.update({
    where: { id },
    data: { status: AttachmentStatus.downloading, startedAt: new Date(), progressPct: 0 },
  });
}

export async function updateProgress(db: Db, id: string, pct: number): Promise<void> {
  // 只更新仍在进行中的行，避免 fire-and-forget 节流写入到达晚于 markCompleted 时
  // 把已完成行的 progressPct 覆盖回中间值（99 等）。
  await db.attachment.updateMany({
    where: {
      id,
      status: {
        in: [AttachmentStatus.queued, AttachmentStatus.downloading, AttachmentStatus.transcoding],
      },
    },
    data: { progressPct: Math.max(0, Math.min(100, Math.round(pct))) },
  });
}

export async function markCompleted(
  db: Db,
  id: string,
  fields: { storagePath: string; byteSize: number; sha256: string; mimeType?: string | null },
): Promise<void> {
  // 注：fire-and-forget 的 updateProgress 可能在 markCompleted 之后才命中 DB，
  // 把 progressPct 覆盖回 99；为此在 status='completed' 上加 WHERE 守卫——
  // updateProgress 可以只 update 非终态行，避免覆盖最终值。
  await db.attachment.update({
    where: { id },
    data: {
      status: AttachmentStatus.completed,
      storagePath: fields.storagePath,
      byteSize: BigInt(fields.byteSize),
      sha256: fields.sha256,
      mimeType: fields.mimeType ?? undefined,
      progressPct: 100,
      finishedAt: new Date(),
    },
  });
}

export async function markFailed(db: Db, id: string, errorMessage: string): Promise<void> {
  await db.attachment.update({
    where: { id },
    data: {
      status: AttachmentStatus.failed,
      errorMessage,
      finishedAt: new Date(),
    },
  });
}

/**
 * 同 spider + sha256 已存在则返回旧 attachment（content dedup）。
 * 用于 fetcher 完成后 commit 前查重，避免重复落盘。
 */
export async function findBySha256(
  db: Db,
  spider: string,
  sha256: string,
): Promise<Attachment | null> {
  const row = await db.attachment.findFirst({
    where: { spider, sha256, status: AttachmentStatus.completed },
  });
  return row ? shape(row) : null;
}

export async function deleteById(db: Db, id: string): Promise<Attachment | null> {
  const existing = await getById(db, id);
  if (!existing) return null;
  await db.attachment.delete({ where: { id } });
  return existing;
}

/**
 * 增量更新关联 run 的附件聚合统计。
 * delta 中只放需要 +1 的字段。
 */
export async function incrementRunStats(
  db: Db,
  runId: string,
  delta: Partial<{ queued: number; completed: number; failed: number }>,
): Promise<void> {
  const data: Prisma.RunUpdateInput = {};
  if (delta.queued) data.attachmentsQueued = { increment: delta.queued };
  if (delta.completed) data.attachmentsCompleted = { increment: delta.completed };
  if (delta.failed) data.attachmentsFailed = { increment: delta.failed };
  if (Object.keys(data).length === 0) return;
  await db.run.update({ where: { id: runId }, data });
}
