import 'server-only';
import { z } from 'zod';
import { getDb, spiderRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, failValidation, ok } from '@/lib/api/response';
import { syncSpiderSchedule } from '@/lib/worker';

const updateSchema = z.object({
  /** 注册表类型键（如 "youtube-channel-videos"） */
  type: z.string().min(1).max(64),
  /** 用户自定义显示名称（中文友好） */
  name: z.string().min(1).max(128),
  description: z.string().nullish(),
  // API-based spider（YouTube 等）动态构造 startUrls，DB 里允许存空数组
  startUrls: z.array(z.string()).default([]),
  allowedHosts: z.array(z.string()).default([]),
  maxDepth: z.number().int().min(0).max(100).default(2),
  concurrency: z.number().int().min(1).max(64).default(4),
  perHostIntervalMs: z.number().int().min(0).max(60000).default(500),
  enabled: z.boolean().default(true),
  cronSchedule: z.string().nullish(),
  // Spider 运行时参数默认值（channelId / query 等）
  defaultParams: z.record(z.unknown()).default({}),
  // 平台标记（youtube / bilibili 等），与 SPIDER_REGISTRY.platform 对齐
  platform: z.string().max(32).nullish(),
});

interface RouteContext {
  /** URL 路由参数；对应 spiders.id（UUID） */
  params: Promise<{ name: string }>;
}

export async function GET(_req: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { name: id } = await params;
    const db = getDb(env.databaseUrl);
    const spider = await spiderRepo.getById(db, id);
    if (!spider) return fail('NOT_FOUND', `spider not found: ${id}`);
    return ok(spider);
  } catch (err) {
    return failInternal(err);
  }
}

export async function PUT(req: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { name: id } = await params;
    const body = (await req.json()) as unknown;
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return failValidation(parsed.error);

    const db = getDb(env.databaseUrl);
    const spider = await spiderRepo.getById(db, id);
    if (!spider) return fail('NOT_FOUND', `spider not found: ${id}`);

    const updated = await spiderRepo.update(db, id, parsed.data);

    // 同步 pg-boss 调度（新增 / 更新 / 清除）
    await syncSpiderSchedule(id, parsed.data.cronSchedule ?? null).catch((err) => {
      console.warn('[api] syncSpiderSchedule failed:', err);
    });

    return ok(updated);
  } catch (err) {
    return failInternal(err);
  }
}

export async function DELETE(_req: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { name: id } = await params;
    const db = getDb(env.databaseUrl);
    const spider = await spiderRepo.getById(db, id);
    if (!spider) return fail('NOT_FOUND', `spider not found: ${id}`);

    // 先清除 pg-boss 定时调度，再删除记录（避免孤立 schedule）
    await syncSpiderSchedule(id, null).catch((err) => {
      console.warn('[api] syncSpiderSchedule(clear) failed on delete:', err);
    });

    await spiderRepo.remove(db, id);
    return ok({ deleted: id });
  } catch (err) {
    return failInternal(err);
  }
}
