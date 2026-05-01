import 'server-only';
import type { AttachmentEvent } from '@/lib/shared';
import { subscribeAttachment } from '@/lib/worker/index';
import { attachmentRepo, getDb } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Ctx {
  params: Promise<{ id: string }>;
}

const TERMINAL = new Set<string>(['completed', 'failed']);

/**
 * SSE 端点：订阅某个 Attachment 的进度事件。
 *
 * 与 /sse/runs/:id/logs 同样：
 *  - 终态保护：连接建立时若 attachment 已完成/失败，立刻合成一条事件后关闭
 *  - 心跳防代理超时
 *
 * 客户端：
 *   const es = new EventSource(`/sse/attachments/${id}/progress`);
 *   es.addEventListener('progress', (e) => ...);
 *   es.addEventListener('done', () => es.close());
 */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id: attachmentId } = await params;
  const encoder = new TextEncoder();

  const db = getDb(env.databaseUrl);
  const initial = await attachmentRepo.getById(db, attachmentId).catch(() => null);
  const alreadyDone = initial ? TERMINAL.has(initial.status as string) : false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown): void => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
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

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          /* closed */
        }
      }, 30_000);

      send('ready', { attachmentId });

      if (alreadyDone && initial) {
        if (initial.status === 'completed' && initial.storagePath) {
          send('done', {
            type: 'attach_completed',
            attachmentId,
            storagePath: initial.storagePath,
            byteSize: initial.byteSize ?? 0,
            at: Date.now(),
          });
        } else {
          send('done', {
            type: 'attach_failed',
            attachmentId,
            error: initial.errorMessage ?? 'failed',
            at: Date.now(),
          });
        }
        close();
        return;
      }

      const unsubscribe = subscribeAttachment(attachmentId, (event: AttachmentEvent) => {
        if (event.type === 'attach_completed' || event.type === 'attach_failed') {
          send('done', event);
          unsubscribe();
          close();
        } else {
          send('progress', event);
        }
      });
    },
    cancel() {
      // 客户端断开；EventBus 后续事件 enqueue 时会自动失败收尾
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
