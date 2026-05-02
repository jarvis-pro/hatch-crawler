import 'server-only';
import { type Db, settingRepo, SETTINGS_KEYS } from '@/lib/db';

/**
 * Webhook 投递模块。
 *
 * 职责：
 *  - 读取 settings.webhook_url / webhook_secret
 *  - HMAC-SHA256 签名（可选，secret 存在时启用）
 *  - 最多重试 3 次，指数退避（1s / 2s / 4s）
 *  - 每次投递结果写入 webhook_deliveries 表（Prisma ORM）
 *  - 失败时静默忽略，不影响主 job 流程
 */

export interface WebhookPayload {
  event: string;
  runId: string;
  spider: string;
  status: string;
  errorMessage?: string;
  at: string;
}

const MAX_RETRIES = 3;

/**
 * 向配置的 Webhook URL 发送运行结果通知。
 */
export async function notifyWebhook(
  db: Db,
  runId: string,
  spider: string,
  status: string,
  errorMessage?: string,
): Promise<void> {
  const webhookUrl = await settingRepo.get<string>(db, SETTINGS_KEYS.webhookUrl).catch(() => null);
  if (!webhookUrl || typeof webhookUrl !== 'string') return;

  const webhookSecret = await settingRepo
    .get<string>(db, SETTINGS_KEYS.webhookSecret)
    .catch(() => null);

  const payload: WebhookPayload = {
    event: 'run_finished',
    runId,
    spider,
    status,
    ...(errorMessage ? { errorMessage } : {}),
    at: new Date().toISOString(),
  };
  const body = JSON.stringify(payload);

  // HMAC-SHA256 签名（可选）
  let signature: string | null = null;
  if (webhookSecret && typeof webhookSecret === 'string') {
    const { createHmac } = await import('crypto');
    signature = 'sha256=' + createHmac('sha256', webhookSecret).update(body).digest('hex');
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature) headers['x-webhook-signature'] = signature;

  let lastHttpStatus: number | null = null;
  let lastError: string | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });
      lastHttpStatus = res.status;

      if (res.ok) {
        await db.webhookDelivery.create({
          data: {
            eventType: payload.event,
            payload: payload as object,
            url: webhookUrl,
            status: 'delivered',
            attempts: attempt,
            lastStatus: lastHttpStatus,
            deliveredAt: new Date(),
          },
        });
        return;
      }

      lastError = `HTTP ${String(res.status)}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    // 指数退避（最后一次不 sleep）
    if (attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
    }
  }

  // 全部重试耗尽，记录失败
  await db.webhookDelivery
    .create({
      data: {
        eventType: payload.event,
        payload: payload as object,
        url: webhookUrl,
        status: 'failed',
        attempts: MAX_RETRIES,
        lastStatus: lastHttpStatus,
        lastError,
      },
    })
    .catch(() => {}); // 写失败不影响主流程
}
