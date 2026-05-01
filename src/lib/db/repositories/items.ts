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
 * 通过 (spider, url_hash, content_hash) 的唯一索引去重；
 * 内容相同则跳过、isNew = false。
 */
export async function save(db: Db, input: SaveItemInput): Promise<{ isNew: boolean }> {
  const urlHash = sha1(input.url);
  const contentHash = sha1(JSON.stringify(input.payload));
  try {
    // Phase 5：platform/kind/sourceId 是新列，pnpm db:generate 后 Prisma 类型才会包含。
    // 用 as unknown 过渡，运行时行为正确。
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
    // P2002 = 唯一约束冲突 → 已存在相同内容，按 isNew=false 处理
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
