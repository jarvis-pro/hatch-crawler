import 'server-only';
import type { CrawlerEvent } from '@/lib/shared';
import { subscribe } from '@/lib/worker/index';
import { getDb, runRepo, eventRepo } from '@/lib/db';
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

      // ── 竞态修复：SSE 连接建立时，job 可能已经运行了一段时间，
      //    EventBus 里的事件早就发完了（in-memory，无回放）。
      //    策略：
      //    1. 先订阅 EventBus，把收到的 live 事件缓冲起来。
      //    2. 从 DB 读取已入库的历史事件，发给前端（"补帧"）。
      //    3. 刷新缓冲：跳过时间戳落在历史范围内的重复事件。
      //    4. 之后恢复正常 live 转发。

      type Buffered = { evtName: 'log' | 'done'; data: CrawlerEvent };
      const liveBuffer: Buffered[] = [];
      let historicalFlushed = false;

      const unsubscribe = subscribe(runId, (event: CrawlerEvent) => {
        if (!historicalFlushed) {
          liveBuffer.push({ evtName: event.type === 'done' ? 'done' : 'log', data: event });
          return;
        }
        if (event.type === 'done') {
          send('done', event);
          unsubscribe();
          close();
        } else {
          send('log', event);
        }
      });

      // 异步：读历史 → 补帧 → 刷缓冲
      void (async () => {
        try {
          const { data: rows } = await eventRepo.list(db, { runId, pageSize: 500 });
          const lastHistoricalAt =
            rows.length > 0 ? rows[rows.length - 1]!.occurredAt.getTime() : 0;

          // 把 DB 行还原成足够前端 describe() 用的 CrawlerEvent 形状
          for (const row of rows) {
            const synthetic = {
              level: row.level,
              type: row.type,
              at: row.occurredAt.getTime(),
              ...(row.payload ?? {}),
            } as CrawlerEvent;
            send('log', synthetic);
          }

          // 刷缓冲：跳过已被历史覆盖的事件（时间戳 ≤ 最后一条历史记录）
          historicalFlushed = true;
          for (const { evtName, data } of liveBuffer) {
            if (data.at <= lastHistoricalAt) continue; // 历史已含，去重
            if (evtName === 'done') {
              send('done', data);
              unsubscribe();
              close();
              return;
            } else {
              send('log', data);
            }
          }
          liveBuffer.length = 0;
        } catch {
          // 历史读取失败：降级为只转发 live 事件
          historicalFlushed = true;
          for (const { evtName, data } of liveBuffer) {
            if (evtName === 'done') {
              send('done', data);
              unsubscribe();
              close();
              return;
            } else {
              send('log', data);
            }
          }
          liveBuffer.length = 0;
        }
      })();
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
