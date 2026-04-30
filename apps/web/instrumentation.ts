/**
 * Next.js instrumentation hook —— 进程启动时执行一次。
 * 文档：https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 *
 * 我们在这里：
 *  1. 启动 pg-boss worker（消费 crawl 队列）
 *  2. 顺带做 stale-run 清理（worker 启动逻辑里）
 */
export async function register(): Promise<void> {
  // 仅 Node.js 运行时执行（不在 edge / browser）
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // 动态 import，避免在 edge 构建时把 pg-boss 拉进来
  const { startWorker } = await import("./lib/worker/index.js");
  await startWorker();
}
