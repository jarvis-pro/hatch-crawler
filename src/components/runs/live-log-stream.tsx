'use client';
import { useEffect, useRef, useState } from 'react';
import type { CrawlerEvent, EventLevel } from '@/lib/shared';

interface Props {
  runId: string;
  onDone?: () => void;
}

interface LogLine {
  level: EventLevel;
  type: string;
  text: string;
  at: number;
}

type StreamState = 'connecting' | 'streaming' | 'done';

const levelColor: Record<EventLevel, string> = {
  debug: 'text-muted-foreground',
  info: 'text-foreground',
  warn: 'text-orange-600',
  error: 'text-red-600',
};

function describe(e: CrawlerEvent): string {
  switch (e.type) {
    case 'fetched':
      return `已抓取 ${e.url} → ${String(e.status)} (${String(e.durationMs)}ms)`;
    case 'queued':
      return `已入队 ${e.url}（深度 ${String(e.depth)}）`;
    case 'skipped':
      return `已跳过 ${e.url}（${e.reason}）`;
    case 'emitted':
      return `已输出 ${e.itemType}: ${e.url}${e.isNew ? '' : '（重复）'}`;
    case 'fetch_failed':
      return `抓取失败: ${e.url} — ${e.error}`;
    case 'error':
      return `错误: ${e.message}`;
    case 'done':
      return `已完成`;
    default:
      return e.type;
  }
}

export function LiveLogStream({ runId, onDone }: Props) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [state, setState] = useState<StreamState>('connecting');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setState('connecting');
    setLines([]);
    const es = new EventSource(`/sse/runs/${runId}/logs`);

    const onReady = () => {
      setState('streaming');
    };

    const onLog = (ev: MessageEvent<string>) => {
      setState('streaming');
      const event = JSON.parse(ev.data) as CrawlerEvent;
      setLines((prev) => [
        ...prev.slice(-499),
        {
          level: event.level,
          type: event.type,
          text: describe(event),
          at: event.at,
        },
      ]);
    };

    const onDoneEvent = () => {
      setState('done');
      onDone?.();
      es.close();
    };

    es.addEventListener('ready', onReady);
    es.addEventListener('log', onLog);
    es.addEventListener('done', onDoneEvent);

    return () => {
      es.close();
    };
  }, [runId, onDone]);

  // 自动滚到底
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines]);

  return (
    <div
      ref={containerRef}
      className="h-96 overflow-y-auto rounded-md border bg-muted/40 p-3 font-mono text-xs"
    >
      {state === 'connecting' && lines.length === 0 && (
        <div className="text-muted-foreground">连接中…</div>
      )}
      {state === 'streaming' && lines.length === 0 && (
        <div className="text-muted-foreground">等待日志…</div>
      )}
      {state === 'done' && lines.length === 0 && (
        <div className="text-muted-foreground">任务已完成（无日志）</div>
      )}
      {lines.map((line, i) => (
        <div key={i} className={levelColor[line.level]}>
          <span className="mr-2 text-muted-foreground">
            {new Date(line.at).toLocaleTimeString()}
          </span>
          <span className="mr-2 uppercase">{line.level}</span>
          {line.text}
        </div>
      ))}
      {state === 'done' && lines.length > 0 && (
        <div className="mt-2 border-t pt-2 text-muted-foreground">── 任务结束 ──</div>
      )}
    </div>
  );
}
