import 'server-only';
import { getDb, accountRepo } from '@/lib/db';
import { decrypt } from '@/lib/db/repositories/accounts';
import { env } from '@/lib/env';
import { fail, failInternal, ok } from '@/lib/api/response';

export interface TestResult {
  valid: boolean;
  message: string;
}

/**
 * POST /api/accounts/:id/test
 *
 * 对指定凭据发起一次轻量验证请求，更新 last_tested_at / last_test_ok，
 * 返回 { valid, message }。
 *
 * 目前支持：
 *   - youtube + apikey：调用 videos.list（消耗 1 配额单位）
 *   - bilibili / 其他：不需要 API Key，直接返回 valid=true
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
    if (!row) return fail('NOT_FOUND', '凭据不存在');

    // 非 apikey 类型暂不做远程验证
    if (row.kind !== 'apikey') {
      await accountRepo.recordTestResult(db, accountId, true);
      return ok<TestResult>({ valid: true, message: '无需远程验证（非 API Key 凭据）' });
    }

    let valid = false;
    let message = '';

    if (row.platform === 'youtube') {
      const apiKey = decrypt(row.payloadEnc, env.accountsMasterKey);
      // videos.list 是最便宜的 YouTube API 调用（1 配额单位）
      const testUrl =
        `https://www.googleapis.com/youtube/v3/videos` +
        `?part=id&id=dQw4w9WgXcQ&key=${encodeURIComponent(apiKey)}`;

      try {
        const res = await fetch(testUrl, { signal: AbortSignal.timeout(8_000) });
        if (res.ok) {
          valid = true;
          message = 'YouTube API Key 有效';
          // 记录配额消耗（videos.list = 1 单位）
          await accountRepo.incrementQuota(db, accountId, 1);
        } else {
          const body = (await res.json().catch(() => ({}))) as {
            error?: { message?: string };
          };
          message = body.error?.message ?? `HTTP ${res.status}`;
        }
      } catch (err) {
        message = `请求失败：${String(err)}`;
      }
    } else {
      // 其他平台暂无远程验证逻辑
      valid = true;
      message = `${row.platform} 凭据已记录（无远程验证）`;
    }

    await accountRepo.recordTestResult(db, accountId, valid);
    return ok<TestResult>({ valid, message });
  } catch (err) {
    return failInternal(err);
  }
}
