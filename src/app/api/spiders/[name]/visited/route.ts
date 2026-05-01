import 'server-only';
import { getDb, visitedRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { failInternal, ok } from '@/lib/api/response';

interface RouteContext {
  params: Promise<{ name: string }>;
}

/**
 * 清空指定 spider 的所有 visited 记录，强制下次运行重新抓取所有 URL。
 *
 * 适用场景：
 *  - 列表/搜索类 startUrl 被首次抓取后写入 visited，导致后续 run 在第一行就被 skip
 *  - 想强制重抓某个 spider 历史已抓过的页面拿增量
 */
export async function DELETE(_req: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { name } = await params;
    const db = getDb(env.databaseUrl);
    const deleted = await visitedRepo.clearSpider(db, name);
    return ok({ deleted });
  } catch (err) {
    return failInternal(err);
  }
}
