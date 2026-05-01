import 'server-only';
import { eventRepo, getDb, type EventLevel } from '@/lib/db';
import { env } from '@/lib/env';
import { failInternal, ok } from '@/lib/api/response';

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id } = await params;
    const url = new URL(req.url);
    const level = url.searchParams.get('level') as EventLevel | null;
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '100');

    const db = getDb(env.databaseUrl);
    const result = await eventRepo.list(db, {
      runId: id,
      level: level ?? undefined,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 100,
    });
    return ok(result);
  } catch (err) {
    return failInternal(err);
  }
}
