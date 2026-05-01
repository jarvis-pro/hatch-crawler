import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Db } from '../client';

// ── 加解密工具 ────────────────────────────────────────────────────────────────

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * 将 hex 主密钥转成 Buffer。
 * 如果格式不合法，直接抛错——宁可启动时崩溃，也不要用错误密钥加密数据。
 */
function masterKeyBuf(masterKeyHex: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(masterKeyHex)) {
    throw new Error(
      'ACCOUNTS_MASTER_KEY 格式错误：需要 64 位 hex 字符（32 字节）。' +
        "请用 node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" 生成。",
    );
  }
  return Buffer.from(masterKeyHex, 'hex');
}

/**
 * 加密 payload。
 * 输出格式（hex）：iv(12B) + authTag(16B) + ciphertext
 */
export function encrypt(plaintext: string, masterKeyHex: string): string {
  const key = masterKeyBuf(masterKeyHex);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('hex');
}

/**
 * 解密 payload。
 */
export function decrypt(cipherHex: string, masterKeyHex: string): string {
  const key = masterKeyBuf(masterKeyHex);
  const buf = Buffer.from(cipherHex, 'hex');
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct) + decipher.final('utf8');
}

// ── Repository ────────────────────────────────────────────────────────────────

export interface CreateAccountInput {
  platform: string;
  label: string;
  kind: 'cookie' | 'oauth' | 'apikey' | 'session';
  /** 明文 payload（API key / cookie 字符串等），存入 DB 前会加密 */
  payload: string;
  expiresAt?: Date | null;
}

export interface AccountRow {
  id: number;
  platform: string;
  label: string;
  kind: string;
  expiresAt: Date | null;
  status: string;
  lastUsedAt: Date | null;
  failureCount: number;
  createdAt: Date;
  updatedAt: Date;
}

function shape(row: {
  id: number;
  platform: string;
  label: string;
  kind: unknown;
  expiresAt: Date | null;
  status: unknown;
  lastUsedAt: Date | null;
  failureCount: number;
  createdAt: Date;
  updatedAt: Date;
}): AccountRow {
  return {
    id: row.id,
    platform: row.platform,
    label: row.label,
    kind: String(row.kind),
    expiresAt: row.expiresAt,
    status: String(row.status),
    lastUsedAt: row.lastUsedAt,
    failureCount: row.failureCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** 创建凭据，payload 加密后写入 */
export async function create(
  db: Db,
  input: CreateAccountInput,
  masterKeyHex: string,
): Promise<AccountRow> {
  const payloadEnc = encrypt(input.payload, masterKeyHex);
  // Account model 在 pnpm db:generate 后才有完整类型，先用 any cast 过渡
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (db as any).account.create({
    data: {
      platform: input.platform,
      label: input.label,
      kind: input.kind,
      payloadEnc,
      expiresAt: input.expiresAt ?? null,
    },
  });
  return shape(row as Parameters<typeof shape>[0]);
}

/** 按平台列出所有账号（不含加密 payload） */
export async function listByPlatform(db: Db, platform?: string): Promise<AccountRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: unknown[] = await (db as any).account.findMany({
    where: platform ? { platform } : undefined,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      platform: true,
      label: true,
      kind: true,
      expiresAt: true,
      status: true,
      lastUsedAt: true,
      failureCount: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return (rows as Parameters<typeof shape>[0][]).map(shape);
}

/** 按 ID 取一条账号（含加密 payload），用于注入凭据 */
export async function getById(
  db: Db,
  id: number,
): Promise<(AccountRow & { payloadEnc: string }) | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (db as any).account.findUnique({ where: { id } });
  if (!row) return null;
  return {
    ...shape(row as Parameters<typeof shape>[0]),
    payloadEnc: (row as { payloadEnc: string }).payloadEnc,
  };
}

/** 取指定 platform 的第一条 active 账号，解密后返回明文 payload */
export async function getActivePayload(
  db: Db,
  platform: string,
  kind: 'apikey' | 'cookie' | 'oauth' | 'session',
  masterKeyHex: string,
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (db as any).account.findFirst({
    where: { platform, kind, status: 'active' },
    orderBy: { lastUsedAt: 'asc' }, // 优先用最久没用的
  });
  if (!row) return null;

  // 更新 lastUsedAt
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).account.update({
    where: { id: (row as { id: number }).id },
    data: { lastUsedAt: new Date() },
  });

  return decrypt((row as { payloadEnc: string }).payloadEnc, masterKeyHex);
}

/** 删除账号 */
export async function remove(db: Db, id: number): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).account.delete({ where: { id } });
}

/** 记录一次失败；failureCount >= threshold 时自动 ban */
export async function recordFailure(db: Db, id: number, banThreshold = 5): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (db as any).account.update({
    where: { id },
    data: { failureCount: { increment: 1 } },
    select: { failureCount: true },
  });
  if ((row as { failureCount: number }).failureCount >= banThreshold) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).account.update({
      where: { id },
      data: { status: 'banned' },
    });
  }
}
