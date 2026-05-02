'use client';
import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Play, Square } from 'lucide-react';
import { api, type ListResult } from '@/lib/api-client';
import { fmtDate, durationLabel } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RunStatusBadge } from '@/components/runs/run-status-badge';
import type { Spider, Run, Event } from '@/lib/db';

/** 聚合错误事件：按 message 分组计数 */
function aggregateErrors(events: Event[]): { message: string; count: number }[] {
  const errorEvents = events.filter((e) => e.level === 'error');
  const map = new Map<string, number>();
  for (const ev of errorEvents) {
    const key = ev.message ?? ev.type;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([message, count]) => ({ message, count }));
}

export default function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();

  const { data: spider } = useQuery({
    queryKey: ['spider', id],
    queryFn: () => api.get<Spider>(`/api/spiders/${id}`),
  });

  const { data: runsResult, refetch: refetchRuns } = useQuery({
    queryKey: ['runs', id],
    queryFn: () => api.get<ListResult<Run>>(`/api/runs?spiderId=${id}&pageSize=10`),
    refetchInterval: (q) => {
      const runs = q.state.data?.data ?? [];
      return runs.some((r) => r.status === 'running' || r.status === 'queued') ? 3_000 : false;
    },
  });

  const latestRun = runsResult?.data[0];

  const { data: eventsResult } = useQuery({
    queryKey: ['events', latestRun?.id],
    queryFn: () => api.get<ListResult<Event>>(`/api/runs/${latestRun!.id}/events?pageSize=500`),
    enabled: !!latestRun && latestRun.status !== 'queued',
  });

  const triggerRun = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/runs', { spiderId: id }),
    onSuccess: () => {
      toast.success('任务已启动');
      void refetchRuns();
    },
    onError: (err) => toast.error(String(err)),
  });

  const stopRun = useMutation({
    mutationFn: (runId: string) => api.post(`/api/runs/${runId}/stop`),
    onSuccess: () => {
      toast.success('已发送停止信号');
      void qc.invalidateQueries({ queryKey: ['runs', id] });
    },
    onError: (err) => toast.error(String(err)),
  });

  if (!spider) {
    return <div className="py-12 text-center text-sm text-muted-foreground">加载中…</div>;
  }

  const runs = runsResult?.data ?? [];
  const events = eventsResult?.data ?? [];
  const errorGroups = aggregateErrors(events);

  return (
    <div className="space-y-6">
      {/* 标题区 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{spider.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
            {spider.platform && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs">
                {spider.platform}
              </span>
            )}
            <span>{spider.enabled ? '✅ 启用' : '⏸ 停用'}</span>
          </div>
        </div>
        <div className="flex gap-2">
          {latestRun?.status === 'running' ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={stopRun.isPending}
              onClick={() => stopRun.mutate(latestRun.id)}
            >
              <Square className="mr-1.5 h-3.5 w-3.5" />
              停止
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={!spider.enabled || triggerRun.isPending}
              onClick={() => triggerRun.mutate()}
            >
              <Play className="mr-1.5 h-3.5 w-3.5" />
              运行
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <Link href={`/dev/spiders/${id}`}>配置 →</Link>
          </Button>
        </div>
      </div>

      {/* 最近运行摘要 */}
      {latestRun && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              最近运行
              <RunStatusBadge status={latestRun.status} />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 text-center">
              {[
                { label: '已抓取', value: latestRun.fetched },
                { label: '新增', value: latestRun.newItems },
                { label: '输出', value: latestRun.emitted },
                { label: '错误', value: latestRun.errors },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg border bg-muted/40 p-3">
                  <p className="text-xl font-semibold tabular-nums">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
              <span>开始 {fmtDate(latestRun.startedAt)}</span>
              <span>耗时 {durationLabel(latestRun)}</span>
              <Link href={`/data?runId=${latestRun.id}`} className="ml-auto hover:underline">
                查看结果 →
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 错误聚合 */}
      {errorGroups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">错误聚合（最近运行，按出现次数降序）</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {errorGroups.map(({ message, count }, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-2">
                  <span className="mt-0.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
                    ×{count}
                  </span>
                  <p className="text-xs text-muted-foreground">{message}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 历史运行列表 */}
      {runs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">运行历史</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {runs.map((run) => (
                <div key={run.id} className="flex items-center gap-3 px-4 py-2">
                  <RunStatusBadge status={run.status} />
                  <span className="text-xs text-muted-foreground">{fmtDate(run.createdAt)}</span>
                  <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
                    <span>抓 {run.fetched}</span>
                    <span>新 {run.newItems}</span>
                    {run.errors > 0 && <span className="text-red-500">错 {run.errors}</span>}
                  </div>
                  <Link href={`/dev/runs/${run.id}`} className="text-xs hover:underline">
                    日志
                  </Link>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
