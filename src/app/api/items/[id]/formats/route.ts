import 'server-only';
import { itemRepo, getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, ok } from '@/lib/api/response';
import { fetchVideoFormats } from '@/lib/crawler/utils/yt-dlp-formats';

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/items/:id/formats
 *
 * 对指定 item 的 URL 实时调用 yt-dlp --dump-json，
 * 将可用格式写入 payload.videoFormats 并返回结果。
 *
 * 用于详情页"获取格式"按钮——当爬取时未记录格式信息时按需补全。
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id } = await params;
    if (!UUID_RE.test(id)) return fail('NOT_FOUND', `bad item id: ${id}`);

    const db = getDb(env.databaseUrl);
    const item = await itemRepo.getById(db, id);
    if (!item) return fail('NOT_FOUND', `item not found: ${id}`);

    const formats = await fetchVideoFormats(item.url);
    if (!formats) {
      return fail('INTERNAL_ERROR', 'yt-dlp 未能解析该 URL 的格式信息（可能不支持或网络超时）');
    }

    await itemRepo.patchPayload(db, id, { videoFormats: formats });

    return ok(formats);
  } catch (err) {
    return failInternal(err);
  }
}
