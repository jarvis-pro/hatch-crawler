import type { Prisma } from '@prisma/client';
import type { Db } from '../client';
import type { Setting } from '../index';

/**
 * 所有 settings 表的 key 集中定义，避免散落的魔法字符串。
 */
export const SETTINGS_KEYS = {
  /** Webhook 回调 URL */
  webhookUrl: 'webhook_url',
  /** Webhook HMAC 签名密钥（hex 字符串） */
  webhookSecret: 'webhook_secret',
  /** 代理池 URL 列表（string[]） */
  proxyPool: 'proxy_pool',
  /** spider 连续失败自动停用阈值（number，默认 3） */
  maxConsecutiveFailures: 'max_consecutive_failures',
  /** stale run 清理超时分钟数（number，默认 30） */
  staleRunTimeoutMin: 'stale_run_timeout_min',
  /** events 保留天数（number，默认 30） */
  eventsRetentionDays: 'events_retention_days',
} as const;

export type SettingsKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

export async function get<T = unknown>(db: Db, key: string): Promise<T | null> {
  const row = await db.setting.findUnique({ where: { key } });
  return (row?.value as T | undefined) ?? null;
}

export async function set(db: Db, key: string, value: unknown): Promise<void> {
  await db.setting.upsert({
    where: { key },
    create: { key, value: value as Prisma.InputJsonValue },
    update: { value: value as Prisma.InputJsonValue, updatedAt: new Date() },
  });
}

export async function listAll(db: Db): Promise<Setting[]> {
  return db.setting.findMany();
}

export async function remove(db: Db, key: string): Promise<void> {
  await db.setting.delete({ where: { key } });
}
