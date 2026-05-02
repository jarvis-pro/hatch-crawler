import 'server-only';
import { z } from 'zod';
import { getDb, spiderRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { failInternal, failValidation, ok } from '@/lib/api/response';
import { syncSpiderSchedule } from '@/lib/worker';

const createSchema = z.object({
  /** 注册表类型键（如 "youtube-search"） */
  type: z.string().min(1).max(64),
  /** 用户自定义显示名称（中文友好） */
  name: z.string().min(1).max(128),
  description: z.string().nullish(),
  startUrls: z.array(z.string()).default([]),
  allowedHosts: z.array(z.string()).default([]),
  maxDepth: z.number().int().min(0).max(100).default(2),
  concurrency: z.number().int().min(1).max(64).default(4),
  perHostIntervalMs: z.number().int().min(0).max(60000).default(500),
  enabled: z.boolean().default(true),
  cronSchedule: z.string().nullish(),
  defaultParams: z.record(z.unknown()).default({}),
  platform: z.string().max(32).nullish(),
  /** RFC 0003：subscription / batch / extract；缺省时按规则自动推断 */
  taskKind: z.enum(['subscription', 'batch', 'extract']).nullish(),
});

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const taskKind = url.searchParams.get('taskKind') ?? undefined;
    const db = getDb(env.databaseUrl);
    const data = taskKind
      ? await spiderRepo.listByTaskKind(db, taskKind)
      : await spiderRepo.listAll(db);
    return ok(data);
  } catch (err) {
    return failInternal(err);
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as unknown;
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return failValidation(parsed.error);

    const db = getDb(env.databaseUrl);
    const spider = await spiderRepo.create(db, parsed.data);

    // 若设置了 cron，同步到 pg-boss
    await syncSpiderSchedule(spider.id, parsed.data.cronSchedule ?? null).catch((err) => {
      console.warn('[api] syncSpiderSchedule failed:', err);
    });

    return ok(spider);
  } catch (err) {
    return failInternal(err);
  }
}
