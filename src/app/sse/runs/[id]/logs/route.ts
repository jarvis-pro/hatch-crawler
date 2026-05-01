import 'server-only';
import type { CrawlerEvent } from '@/lib/shared';
import { subscribe } from '@/lib/worker/index';
import { getDb, runRepo } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

/** Run 已结束的终态集合 */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'stopped']);

/**
 * SSE 端点：订阅某个 Run 的实时事件。
 *
 * Worker 把 CrawlerEvent 推到 EventBus，这里转发为 SSE message。
 *
 * 竞态保护：若客户端建立连接时 run 已处于终态（job 完成极快），
 * 立即发送一条合成的 done 事件，避免浏览器永久卡在"等待事件…"。
 *
 * 客户端：
 *   const es = new EventSource(`/sse/runs/${id}/logs`);
 *   es.addEventListener('log', (e) => ...);
 *   es.addEventListener('done', () => es.close());
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id: runId } = await params;
  const encoder = new TextEncoder();

  // 查一次 run 状态，用于竞态检测
  const db = getDb(env.databaseUrl);
  const run = await runRepo.getById(db, runId).catch(() => null);
  const alreadyFinished = run ? TERMINAL_STATUSES.has(run.status) : false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown): void => {
        const payload = `event: ${event}\n` + `data: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          // controller 已关闭
        }
      };

      const close = (): void => {
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // 心跳：30s 空 comment 防代理超时
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          /* closed */
        }
      }, 30_000);

      // 初始 ready 信号
      send('ready', { runId });

      // 竞态保护：run 已结束则直接发合成 done，不再等 EventBus
      if (alreadyFinished) {
        send('done', {
          type: 'done',
          level: 'info',
          stats: {
            fetched: run?.fetched ?? 0,
            emitted: run?.emitted ?? 0,
            newItems: run?.newItems ?? 0,
            errors: run?.errors ?? 0,
            durationMs: 0,
          },
          at: Date.now(),
        });
        close();
        return;
      }

      const unsubscribe = subscribe(runId, (event: CrawlerEvent) => {
        if (event.type === 'done') {
          send('done', event);
          // 让 client 自己关闭；server 端这里收尾
          unsubscribe();
          close();
        } else {
          send('log', event);
        }
      });
    },
    cancel() {
      // 客户端断开，自动收尾在 start 的 unsubscribe / clearInterval 里没法访问到
      // 不过 worker 端的事件会持续发到 EventBus，等下个事件到来时 enqueue 失败会触发清理
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
