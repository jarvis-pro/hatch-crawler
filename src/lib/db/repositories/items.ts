import { createHash } from 'node:crypto';
import { type Prisma } from '@prisma/client';
import type { Db } from '../client';
import type { Item } from '../index';

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

function shape(row: { payload: unknown; [k: string]: unknown }): Item {
  return { ...row, payload: row.payload as Record<string, unknown> } as Item;
}

export interface SaveItemInput {
  runId: string | null;
  spider: string;
  type: string;
  url: string;
  payload: Record<string, unknown>;
  // Phase 5
  platform?: string | null;
  kind?: string | null;
  sourceId?: string | null;
}

/**
 * 保存一条抓取结果。
 *
 * 去重策略（双层）：
 *   1. platform + sourceId 均非空时：upsert ——同一来源条目始终保留最新 payload，
 *      由 uniq_items_platform_source 部分唯一索引保障。
 *   2. 其余情况：(spider, url_hash, content_hash) 唯一索引；冲突时 isNew=false。
 *
 * isNew=true  → 首次写入
 * isNew=false → 已存在（内容相同跳过 / upsert 更新了已有行）
 */
export async function save(db: Db, input: SaveItemInput): Promise<{ isNew: boolean }> {
  const urlHash = sha1(input.url);
  const contentHash = sha1(JSON.stringify(input.payload));

  // ── 有来源 ID：走 upsert，用 platform+sourceId 去重 ──────────────────────────
  if (input.platform && input.sourceId) {
    // 利用部分唯一索引做 ON CONFLICT，xmax=0 表示新插入行（xmax!=0 表示已更新行）
    const rows = await db.$queryRawUnsafe<{ is_new: boolean }[]>(
      `INSERT INTO "items"
         ("run_id","spider","type","url","url_hash","content_hash","payload","platform","kind","source_id")
       VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
       ON CONFLICT ("platform","source_id")
         WHERE "platform" IS NOT NULL AND "source_id" IS NOT NULL
       DO UPDATE SET
         "run_id"       = EXCLUDED."run_id",
         "spider"       = EXCLUDED."spider",
         "url"          = EXCLUDED."url",
         "url_hash"     = EXCLUDED."url_hash",
         "content_hash" = EXCLUDED."content_hash",
         "payload"      = EXCLUDED."payload",
         "kind"         = EXCLUDED."kind",
         "fetched_at"   = now()
       RETURNING (xmax = 0) AS is_new`,
      input.runId,
      input.spider,
      input.type,
      input.url,
      urlHash,
      contentHash,
      JSON.stringify(input.payload),
      input.platform,
      input.kind ?? null,
      input.sourceId,
    );
    return { isNew: rows[0]?.is_new === true };
  }

  // ── 无来源 ID：原有 try/catch 路径 ───────────────────────────────────────────
  try {
    await (db.item.create as (args: unknown) => Promise<unknown>)({
      data: {
        runId: input.runId,
        spider: input.spider,
        type: input.type,
        url: input.url,
        urlHash,
        contentHash,
        payload: input.payload,
        platform: input.platform ?? null,
        kind: input.kind ?? null,
        sourceId: input.sourceId ?? null,
      },
    });
    return { isNew: true };
  } catch (err) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return { isNew: false };
    }
    throw err;
  }
}

export interface ListParams {
  spider?: string;
  type?: string;
  runId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  // Phase 5
  platform?: string;
  kind?: string;
}

export async function list(
  db: Db,
  params: ListParams = {},
): Promise<{
  data: Item[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;

  // Phase 5：platform / kind 是 pnpm db:generate 后新增的列，
  // 用 unknown 过渡直到本地重新生成 Prisma client。
  const where = {} as Prisma.ItemWhereInput & {
    platform?: string;
    kind?: string;
  };
  if (params.spider) where.spider = params.spider;
  if (params.type) where.type = params.type;
  if (params.runId) where.runId = params.runId;
  if (params.platform) where.platform = params.platform;
  if (params.kind) where.kind = params.kind;

  // 简单 ILIKE 全文搜索：URL 或 payload->>'title'
  // Prisma 的 jsonb path filter 不直接支持 ILIKE，所以这条用 $queryRaw 分支
  if (params.q) {
    const pattern = `%${params.q}%`;
    const baseFilters: string[] = [];
    const values: (string | number)[] = [pattern, pattern];
    if (params.spider) {
      baseFilters.push(`"spider" = $${values.length + 1}`);
      values.push(params.spider);
    }
    if (params.type) {
      baseFilters.push(`"type" = $${values.length + 1}`);
      values.push(params.type);
    }
    if (params.runId) {
      baseFilters.push(`"run_id" = $${values.length + 1}::uuid`);
      values.push(params.runId);
    }
    if (params.platform) {
      baseFilters.push(`"platform" = $${values.length + 1}`);
      values.push(params.platform);
    }
    if (params.kind) {
      baseFilters.push(`"kind" = $${values.length + 1}`);
      values.push(params.kind);
    }
    const extra = baseFilters.length > 0 ? ' AND ' + baseFilters.join(' AND ') : '';
    const dataSql = `SELECT * FROM "items" WHERE ("url" ILIKE $1 OR "payload"->>'title' ILIKE $2)${extra} ORDER BY "fetched_at" DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    const countSql = `SELECT count(*)::int AS value FROM "items" WHERE ("url" ILIKE $1 OR "payload"->>'title' ILIKE $2)${extra}`;
    const [rows, countRows] = await Promise.all([
      db.$queryRawUnsafe<Item[]>(dataSql, ...values),
      db.$queryRawUnsafe<{ value: number }[]>(countSql, ...values),
    ]);
    return {
      data: rows.map(shape),
      total: countRows[0]?.value ?? 0,
      page,
      pageSize,
    };
  }

  const [rows, total] = await Promise.all([
    db.item.findMany({
      where,
      orderBy: { fetchedAt: 'desc' },
      take: pageSize,
      skip: (page - 1) * pageSize,
    }),
    db.item.count({ where }),
  ]);

  return { data: rows.map(shape), total, page, pageSize };
}

export async function getById(db: Db, id: number): Promise<Item | null> {
  const row = await db.item.findUnique({ where: { id } });
  return row ? shape(row) : null;
}

/**
 * 将 patch 对象合并到 item 的 jsonb payload（浅合并，等价于 payload || patch）。
 * 用于事后补充格式信息等场景。
 */
export async function patchPayload(
  db: Db,
  id: number,
  patch: Record<string, unknown>,
): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE "items" SET "payload" = "payload" || $1::jsonb WHERE "id" = $2`,
    JSON.stringify(patch),
    id,
  );
}

/**
 * 批量删除指定 id 列表的条目。
 * 返回实际删除行数。
 */
export async function deleteMany(db: Db, ids: number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await db.item.deleteMany({ where: { id: { in: ids } } });
  return result.count;
}
