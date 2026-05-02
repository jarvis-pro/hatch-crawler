import { type Prisma } from '@prisma/client';
import type { Db } from '../client';
import type { ExtractJob, ExtractJobStatus, ExtractUrlResult, NewExtractJob } from '../index';

/**
 * extract_jobs 仓库。
 *
 * 设计要点：
 *  - 任务壳很薄，只承担"批次维度的进度聚合"职责
 *  - 单条 URL 的状态写在 results jsonb 内部，避免再开一张子表
 *  - 计数更新走 SQL 原子操作（jsonb_set + integer +=），并发安全
 *  - 终态判定：succeeded + failed >= total → status='completed' + finished_at=now()
 */

function shape(row: {
  id: string;
  submittedUrls: unknown;
  results: unknown;
  total: number;
  succeeded: number;
  failed: number;
  status: string;
  createdAt: Date;
  finishedAt: Date | null;
}): ExtractJob {
  return {
    id: row.id,
    submittedUrls: (row.submittedUrls ?? []) as string[],
    results: (row.results ?? {}) as Record<string, ExtractUrlResult>,
    total: row.total,
    succeeded: row.succeeded,
    failed: row.failed,
    status: row.status as ExtractJobStatus,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

/**
 * 创建 extract_job。
 * total 由 results 的 key 数派生（已在 API 层去重）。
 */
export async function create(db: Db, input: NewExtractJob): Promise<ExtractJob> {
  const total = Object.keys(input.results).length;
  const row = await db.extractJob.create({
    data: {
      submittedUrls: input.submittedUrls as Prisma.InputJsonValue,
      results: input.results as unknown as Prisma.InputJsonValue,
      total,
      succeeded: 0,
      failed: 0,
      status: total === 0 ? 'completed' : 'running',
      finishedAt: total === 0 ? new Date() : null,
    },
  });
  return shape(row);
}

export async function getById(db: Db, id: string): Promise<ExtractJob | null> {
  const row = await db.extractJob.findUnique({ where: { id } });
  return row ? shape(row) : null;
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  status?: ExtractJobStatus;
}

export async function list(
  db: Db,
  params: ListParams = {},
): Promise<{ data: ExtractJob[]; total: number; page: number; pageSize: number }> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;

  const where: Prisma.ExtractJobWhereInput = {};
  if (params.status) where.status = params.status;

  const [rows, total] = await Promise.all([
    db.extractJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    db.extractJob.count({ where }),
  ]);

  return { data: rows.map(shape), total, page, pageSize };
}

/**
 * 单条 URL 处理完成时调用：
 *  - 更新 results[canonicalUrl] 内的 status / errorCode / errorMessage / itemId / finishedAt
 *  - 原子递增 succeeded 或 failed 计数
 *  - 若 succeeded + failed >= total，把 status 标为 'completed' 并写 finished_at
 *
 * 在单个 UPDATE 内完成所有变更，行级锁天然串行化并发 worker。
 */
export interface RecordOutcomeInput {
  jobId: string;
  canonicalUrl: string;
  outcome:
    | { kind: 'succeeded'; itemId: string }
    | { kind: 'failed'; errorCode: string; errorMessage: string };
}

export async function recordOutcome(db: Db, input: RecordOutcomeInput): Promise<void> {
  const { jobId, canonicalUrl, outcome } = input;
  const finishedAtIso = new Date().toISOString();

  // 构造单条 URL 的更新 patch（与 results[canonicalUrl] 的现有内容浅合并）
  const patch: Record<string, unknown> = {
    status: outcome.kind,
    finishedAt: finishedAtIso,
  };
  if (outcome.kind === 'succeeded') {
    patch.itemId = outcome.itemId;
  } else {
    patch.errorCode = outcome.errorCode;
    patch.errorMessage = outcome.errorMessage;
  }

  // 一句 SQL 同时：合并 patch 进 jsonb / 递增计数 / 终态判定
  // jsonb_set 第三个参数用 (results->canonicalUrl) || patch，浅合并保留 originalUrl/platform
  const counterCol = outcome.kind === 'succeeded' ? 'succeeded' : 'failed';

  await db.$executeRawUnsafe(
    `UPDATE "extract_jobs"
       SET "results" = jsonb_set(
             "results",
             ARRAY[$2::text],
             COALESCE("results"->$2, '{}'::jsonb) || $3::jsonb,
             true
           ),
           "${counterCol}" = "${counterCol}" + 1,
           "status" = CASE
             WHEN ("succeeded" + "failed" + 1) >= "total" THEN 'completed'
             ELSE "status"
           END,
           "finished_at" = CASE
             WHEN ("succeeded" + "failed" + 1) >= "total" THEN now()
             ELSE "finished_at"
           END
     WHERE "id" = $1::uuid`,
    jobId,
    canonicalUrl,
    JSON.stringify(patch),
  );
}

/**
 * 批量删除（仅终态记录），返回实际删除数。
 * items.extract_job_id 由 ON DELETE SET NULL 保留 item 行。
 */
export async function removeMany(db: Db, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db.extractJob.deleteMany({
    where: {
      id: { in: ids },
      status: 'completed',
    },
  });
  return result.count;
}
