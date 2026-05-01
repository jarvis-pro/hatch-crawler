import 'server-only';
import { z } from 'zod';
import { getDb, spiderRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, failValidation, ok } from '@/lib/api/response';

const updateSchema = z.object({
  displayName: z.string().min(1).max(128),
  description: z.string().nullish(),
  startUrls: z.array(z.string().url()).min(1),
  allowedHosts: z.array(z.string()).default([]),
  maxDepth: z.number().int().min(0).max(10).default(2),
  concurrency: z.number().int().min(1).max(64).default(4),
  perHostIntervalMs: z.number().int().min(0).max(60000).default(500),
  enabled: z.boolean().default(true),
  cronSchedule: z.string().nullish(),
});

interface RouteContext {
  params: Promise<{ name: string }>;
}

export async function GET(_req: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { name } = await params;
    const db = getDb(env.databaseUrl);
    const spider = await spiderRepo.getByName(db, name);
    if (!spider) return fail('NOT_FOUND', `spider not found: ${name}`);
    return ok(spider);
  } catch (err) {
    return failInternal(err);
  }
}

export async function PUT(req: Request, { params }: RouteContext): Promise<Response> {
  try {
    const { name } = await params;
    const body = (await req.json()) as unknown;
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) return failValidation(parsed.error);

    const db = getDb(env.databaseUrl);
    const updated = await spiderRepo.upsert(db, {
      name,
      ...parsed.data,
    });
    return ok(updated);
  } catch (err) {
    return failInternal(err);
  }
}
