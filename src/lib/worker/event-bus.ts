import { EventEmitter } from 'node:events';
import 'server-only';
import type { AttachmentEvent, CrawlerEvent } from '@/lib/shared';

/**
 * 进程内事件总线。
 *
 * Worker 把 CrawlerEvent 发到 `runId` 频道；
 * SSE handler 订阅同一 `runId` 把事件流式推给浏览器。
 *
 * 单进程合并部署的关键 —— 不需要 Redis pub/sub。
 */

const CACHE_KEY = '__hatchCrawlerEventBus';
const globalCache = globalThis as typeof globalThis & {
  [CACHE_KEY]?: EventEmitter;
};

function getEmitter(): EventEmitter {
  if (!globalCache[CACHE_KEY]) {
    const emitter = new EventEmitter();
    // 默认 10 个 listener 上限太低，看板上可能多个 SSE 连接
    emitter.setMaxListeners(100);
    globalCache[CACHE_KEY] = emitter;
  }
  return globalCache[CACHE_KEY]!;
}

export function publish(runId: string, event: CrawlerEvent): void {
  getEmitter().emit(`run:${runId}`, event);
}

export function subscribe(runId: string, listener: (event: CrawlerEvent) => void): () => void {
  const channel = `run:${runId}`;
  getEmitter().on(channel, listener);
  return () => {
    getEmitter().off(channel, listener);
  };
}

// ── RFC 0002 Phase A：附件事件单独通道 ─────────────────────────────────────────

export function publishAttachment(attachmentId: string, event: AttachmentEvent): void {
  getEmitter().emit(`attach:${attachmentId}`, event);
}

export function subscribeAttachment(
  attachmentId: string,
  listener: (event: AttachmentEvent) => void,
): () => void {
  const channel = `attach:${attachmentId}`;
  getEmitter().on(channel, listener);
  return () => {
    getEmitter().off(channel, listener);
  };
}
