"use client";
import { useEffect, useRef, useState } from "react";
import type { CrawlerEvent, EventLevel } from "@hatch-crawler/shared";

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

const levelColor: Record<EventLevel, string> = {
  debug: "text-muted-foreground",
  info: "text-foreground",
  warn: "text-orange-600",
  error: "text-red-600",
};

function describe(e: CrawlerEvent): string {
  switch (e.type) {
    case "fetched":
      return `fetched ${e.url} → ${String(e.status)} (${String(e.durationMs)}ms)`;
    case "queued":
      return `queued ${e.url} (depth ${String(e.depth)})`;
    case "skipped":
      return `skipped ${e.url} (${e.reason})`;
    case "emitted":
      return `emitted ${e.itemType}: ${e.url}${e.isNew ? "" : " (dup)"}`;
    case "fetch_failed":
      return `fetch failed: ${e.url} — ${e.error}`;
    case "error":
      return `error: ${e.message}`;
    case "done":
      return `done`;
    default:
      return e.type;
  }
}

export function LiveLogStream({ runId, onDone }: Props) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource(`/sse/runs/${runId}/logs`);

    const onLog = (ev: MessageEvent<string>) => {
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
      onDone?.();
      es.close();
    };

    es.addEventListener("log", onLog);
    es.addEventListener("done", onDoneEvent);

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
      {lines.length === 0 && (
        <div className="text-muted-foreground">等待事件…</div>
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
    </div>
  );
}
