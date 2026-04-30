import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../client.js";
import { items, type Item } from "../schema.js";

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

export interface SaveItemInput {
  runId: string | null;
  spider: string;
  type: string;
  url: string;
  payload: Record<string, unknown>;
}

/**
 * 保存一条抓取结果。
 * 通过 (spider, url_hash, content_hash) 的唯一索引去重；
 * 内容相同则跳过、isNew = false。
 */
export async function save(
  db: Db,
  input: SaveItemInput,
): Promise<{ isNew: boolean }> {
  const urlHash = sha1(input.url);
  const contentHash = sha1(JSON.stringify(input.payload));
  const result = await db
    .insert(items)
    .values({
      runId: input.runId,
      spider: input.spider,
      type: input.type,
      url: input.url,
      urlHash,
      contentHash,
      payload: input.payload,
    })
    .onConflictDoNothing()
    .returning({ id: items.id });
  return { isNew: result.length > 0 };
}

export interface ListParams {
  spider?: string;
  type?: string;
  runId?: string;
  q?: string;
  page?: number;
  pageSize?: number;
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

  const conditions = [];
  if (params.spider) conditions.push(eq(items.spider, params.spider));
  if (params.type) conditions.push(eq(items.type, params.type));
  if (params.runId) conditions.push(eq(items.runId, params.runId));
  if (params.q) {
    // 简单 ILIKE 全文搜索：URL 或 payload->>'title'
    const pattern = `%${params.q}%`;
    conditions.push(
      sql`(${items.url} ILIKE ${pattern} OR ${items.payload}->>'title' ILIKE ${pattern})`,
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const data = await db
    .select()
    .from(items)
    .where(where)
    .orderBy(desc(items.fetchedAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [c] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(items)
    .where(where);

  return { data, total: c?.value ?? 0, page, pageSize };
}

export async function getById(db: Db, id: number): Promise<Item | null> {
  const rows = await db.select().from(items).where(eq(items.id, id)).limit(1);
  return rows[0] ?? null;
}
