/**
 * 跨进程的爬虫事件类型。
 *
 * 这些事件由 packages/crawler 在 runSpider 内部发射，
 * 调用方（CLI / Worker）订阅 onEvent 回调消费：
 *  - CLI 写 JSONL、打日志
 *  - Worker 写 events 表、广播到 Redis pub/sub
 */

export interface RunStats {
  fetched: number;
  emitted: number;
  newItems: number;
  errors: number;
  durationMs: number;
}

export type EventLevel = 'debug' | 'info' | 'warn' | 'error';

export type CrawlerEvent =
  | {
      type: 'queued';
      level: EventLevel;
      url: string;
      depth: number;
      at: number;
    }
  | {
      type: 'fetched';
      level: EventLevel;
      url: string;
      finalUrl: string;
      status: number;
      durationMs: number;
      at: number;
    }
  | {
      type: 'fetch_failed';
      level: EventLevel;
      url: string;
      attempt: number;
      error: string;
      at: number;
    }
  | {
      type: 'skipped';
      level: EventLevel;
      url: string;
      reason: 'non_2xx' | 'depth';
      at: number;
    }
  | {
      type: 'emitted';
      level: EventLevel;
      url: string;
      itemType: string;
      isNew: boolean;
      at: number;
    }
  | {
      type: 'error';
      level: EventLevel;
      url?: string;
      message: string;
      // 可选结构化负载，用于把 spider 业务上下文（channelId、http status、API code 等）
      // 一起带进 events 表的 payload 列。仅在 level==='error' 时才计入 RunStats.errors。
      payload?: Record<string, unknown>;
      at: number;
    }
  | {
      type: 'stats';
      level: EventLevel;
      stats: RunStats;
      at: number;
    }
  | {
      type: 'done';
      level: EventLevel;
      stats: RunStats;
      at: number;
    };

/** 便捷：从 type 推导出对应的负载形状 */
export type CrawlerEventOf<T extends CrawlerEvent['type']> = Extract<CrawlerEvent, { type: T }>;
