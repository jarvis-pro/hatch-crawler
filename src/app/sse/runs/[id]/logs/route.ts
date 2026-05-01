import 'server-only';
import type { CrawlerEvent } from '@/lib/shared';
import { subscribe } from '@/lib/worker/index';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

/**
 * SSE 端点：订阅某个 Run 的实时事件。
 *
 * Worker 把 CrawlerEvent 推到 EventBus，这里转发为 SSE message。
 *
 * 客户端：
 *   const es = new EventSource(`/sse/runs/${id}/logs`);
 *   es.addEventListener('log', (e) => ...);
 *   es.addEventListener('done', () => es.close());
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id: runId } = await params;
  const encoder = new TextEncoder();

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

      // 心跳：30s 空 comment 防代理超时
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          /* closed */
        }
      }, 30_000);

      const unsubscribe = subscribe(runId, (event: CrawlerEvent) => {
        if (event.type === 'done') {
          send('done', event);
          // 让 client 自己关闭；server 端这里收尾
          clearInterval(heartbeat);
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        } else {
          send('log', event);
        }
      });

      // 初始 ready 信号
      send('ready', { runId });
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
