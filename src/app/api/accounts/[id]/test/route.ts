import 'server-only';
import { getDb, accountRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, ok } from '@/lib/api/response';
import { ApiClient } from '@/lib/crawler/fetcher/api';

/**
 * 测试一条账号凭据是否仍然有效。
 * 目前支持 YouTube API key：尝试调一次 quota 极低的 videoCategories 接口。
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const accountId = Number(id);
    if (!Number.isFinite(accountId)) return fail('VALIDATION_ERROR', 'invalid id');

    const db = getDb(env.databaseUrl);
    const row = await accountRepo.getById(db, accountId);
    if (!row) return fail('NOT_FOUND', 'account not found');

    const payload = accountRepo.decrypt(row.payloadEnc, env.accountsMasterKey);

    if (row.platform === 'youtube' && row.kind === 'apikey') {
      const client = new ApiClient({ perRequestDelayMs: 0 });
      const res = await client.get<{ error?: { message?: string } }>(
        'https://www.googleapis.com/youtube/v3/videoCategories',
        { part: 'snippet', regionCode: 'US', key: payload },
      );
      if (res.status === 200) {
        return ok({ valid: true, message: 'API key 有效' });
      }
      return ok({ valid: false, message: res.data?.error?.message ?? `HTTP ${res.status}` });
    }

    return fail('VALIDATION_ERROR', `暂不支持测试 platform=${row.platform} kind=${row.kind}`);
  } catch (err) {
    return failInternal(err);
  }
}
