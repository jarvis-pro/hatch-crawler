import 'server-only';
import { getDb, spiderRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { failInternal, ok } from '@/lib/api/response';

export async function GET(): Promise<Response> {
  try {
    const db = getDb(env.databaseUrl);
    const data = await spiderRepo.listAll(db);
    return ok(data);
  } catch (err) {
    return failInternal(err);
  }
}
