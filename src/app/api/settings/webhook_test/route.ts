import 'server-only';
import { getDb, settingRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, ok } from '@/lib/api/response';

export async function POST(): Promise<Response> {
  try {
    const db = getDb(env.databaseUrl);
    const webhookUrl = await settingRepo.get<string>(db, 'webhook_url');

    if (!webhookUrl || typeof webhookUrl !== 'string') {
      return fail('VALIDATION_ERROR', 'webhook_url 未配置');
    }

    const body = JSON.stringify({
      event: 'test',
      message: '这是来自 hatch-crawler 的测试通知',
      at: new Date().toISOString(),
    });

    let res: globalThis.Response;
    try {
      res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      return fail('INTERNAL_ERROR', `发送失败：${msg}`);
    }

    if (!res.ok) {
      return fail('INTERNAL_ERROR', `Webhook 响应 HTTP ${res.status}`);
    }

    return ok({ sent: true });
  } catch (err) {
    return failInternal(err);
  }
}
