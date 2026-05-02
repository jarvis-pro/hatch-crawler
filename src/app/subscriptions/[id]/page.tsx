'use client';
import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Play, ExternalLink } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RunStatusBadge } from '@/components/runs/run-status-badge';
import type { Spider, Run, Item } from '@/lib/db';

interface ListResult<T> {
  data: T[];
  total: number;
}

interface TrendPoint {
  date: string;
  count: number;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TrendBar({ points }: { points: TrendPoint[] }) {
  const max = Math.max(...points.map((p) => p.count), 1);
  return (
    <div className="flex h-20 items-end gap-1">
      {points.map((p) => (
        <div key={p.date} className="group relative flex-1" title={`${p.date}: ${p.count} 条`}>
          <div
            className="w-full rounded-t bg-primary/70 transition-all group-hover:bg-primary"
            style={{ height: `${Math.max((p.count / max) * 100, p.count > 0 ? 4 : 0)}%` }}
          />
          <p className="mt-1 text-center text-[9px] text-muted-foreground">{p.date.slice(5)}</p>
        </div>
      ))}
    </div>
  );
}

export default function SubscriptionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();

  const { data: spider } = useQuery({
    queryKey: ['spider', id],
    queryFn: () => api.get<Spider>(`/api/spiders/${id}`),
  });

  const { data: runsResult } = useQuery({
    queryKey: ['runs', id],
    queryFn: () => api.get<ListResult<Run>>(`/api/runs?spiderId=${id}&pageSize=5`),
    refetchInterval: 10_000,
  });

  const { data: trend } = useQuery({
    queryKey: ['trend', id],
    queryFn: () => api.get<TrendPoint[]>(`/api/stats/trend?days=14&spiderId=${id}`),
  });

  const { data: recentItems } = useQuery({
    queryKey: ['items', 'recent', id],
    queryFn: async () => {
      // 通过最近 5 个 runs 的第一个 runId 拉 items
      const runs = runsResult?.data ?? [];
      if (runs.length === 0) return { data: [] as Item[] };
      const firstRunId = runs[0]?.id;
      if (!firstRunId) return { data: [] as Item[] };
      return api.get<ListResult<Item>>(`/api/items?runId=${firstRunId}&pageSize=20`);
    },
    enabled: !!runsResult,
  });

  const triggerRun = useMutation({
    mutationFn: () => api.post<{ id: string }>('/api/runs', { spiderId: id }),
    onSuccess: ({ id: runId }) => {
      toast.success('任务已启动');
      void qc.invalidateQueries({ queryKey: ['runs', id] });
      window.location.href = `/dev/runs/${runId}`;
    },
    onError: (err) => toast.error(String(err)),
  });

  if (!spider) {
    return <div className="py-12 text-center text-sm text-muted-foreground">加载中…</div>;
  }

  const runs = runsResult?.data ?? [];
  const items = recentItems?.data ?? [];

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
            {spider.cronSchedule && (
              <span className="font-mono text-xs">{spider.cronSchedule}</span>
            )}
            <span>{spider.enabled ? '✅ 启用中' : '⏸ 已停用'}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            disabled={!spider.enabled || triggerRun.isPending}
            onClick={() => triggerRun.mutate()}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" />
            立即运行
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/dev/spiders/${id}`}>配置 →</Link>
          </Button>
        </div>
      </div>

      {/* 趋势图 */}
      {trend && trend.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">近 14 天新增数据</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendBar points={trend} />
          </CardContent>
        </Card>
      )}

      {/* 最近运行 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">最近运行</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">暂无运行记录</p>
          ) : (
            <div className="divide-y">
              {runs.map((run) => (
                <div key={run.id} className="flex items-center gap-3 px-4 py-3">
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
          )}
        </CardContent>
      </Card>

      {/* 最近数据预览 */}
      {items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-sm">
              <span>最近抓取（上次运行）</span>
              <Link
                href={`/data?runId=${runs[0]?.id ?? ''}`}
                className="text-xs font-normal text-muted-foreground hover:underline"
              >
                查看全部 →
              </Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {items.slice(0, 10).map((item) => {
                const p = item.payload as Record<string, unknown>;
                const title = (p?.title as string | undefined) ?? item.url;
                const thumb = (
                  (p?.media as { kind?: string; url?: string }[] | undefined) ?? []
                ).find((m) => m.kind === 'thumbnail')?.url;
                return (
                  <div key={item.id} className="flex items-center gap-3 px-4 py-2">
                    {thumb && (
                      <img src={thumb} alt="" className="h-8 w-12 shrink-0 rounded object-cover" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{title}</p>
                    </div>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
