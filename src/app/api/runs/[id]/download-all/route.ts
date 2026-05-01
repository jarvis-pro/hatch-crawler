import 'server-only';
import { getDb, runRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, ok } from '@/lib/api/response';
import { dispatchForRun, isYoutubeDownloadEnabled } from '@/lib/worker/attachment-dispatcher';

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/runs/:id/download-all
 *
 * 手动一键派发本次 run 所有 item 的可下载附件——和 spider.autoDownload 共用同一套
 * 派发逻辑，但不需要 spider 开启 autoDownload 也能用。
 *
 * 幂等：已存在的 (itemId, sourceUrl, fetcherKind) 跳过。
 */
export async function POST(_req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id: runId } = await params;
    const db = getDb(env.databaseUrl);
    const run = await runRepo.getById(db, runId);
    if (!run) return fail('NOT_FOUND', `run not found: ${runId}`);

    const allowYoutube = await isYoutubeDownloadEnabled(db);
    const summary = await dispatchForRun(db, runId, { allowYoutube });
    return ok(summary);
  } catch (err) {
    return failInternal(err);
  }
}
