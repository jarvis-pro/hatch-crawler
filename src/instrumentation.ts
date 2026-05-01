/**
 * Next.js instrumentation hook —— 进程启动时执行一次。
 * 文档：https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 *
 * 在这里：
 *  1. 跑数据库迁移（idempotent，多次重启没问题）
 *  2. 启动 pg-boss worker（消费 crawl 队列、stale-run 清理）
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // 动态 import：避免在 edge / build 时把这些 server-only 包拉进来
  const { runMigrations } = await import('@/lib/db');
  const { startWorker } = await import('./lib/worker');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required (set in .env or docker-compose env)');
  }

  console.warn('[instrumentation] running migrations...');
  await runMigrations(databaseUrl);
  console.warn('[instrumentation] migrations done');

  await startWorker();
}
