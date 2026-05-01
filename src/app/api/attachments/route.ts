import 'server-only';
import { AttachmentStatus, attachmentRepo, getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { failInternal, ok } from '@/lib/api/response';

const VALID_STATUSES = new Set<string>(Object.values(AttachmentStatus));

/**
 * GET /api/attachments —— 全局列表（看板 /attachments 总览页用）
 *
 * Query：
 *   spider:   过滤
 *   status:   过滤；逗号分隔（如 status=failed,downloading）
 *   page, pageSize
 */
export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const spider = url.searchParams.get('spider') ?? undefined;
    const statusRaw = url.searchParams.get('status');
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');

    let status: AttachmentStatus | AttachmentStatus[] | undefined;
    if (statusRaw) {
      const parts = statusRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => VALID_STATUSES.has(s)) as AttachmentStatus[];
      if (parts.length === 1) status = parts[0];
      else if (parts.length > 1) status = parts;
    }

    const db = getDb(env.databaseUrl);
    const result = await attachmentRepo.list(db, { spider, status, page, pageSize });
    return ok(result);
  } catch (err) {
    return failInternal(err);
  }
}
