'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { Run } from '@/lib/db';
import { api, type ListResult } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatsCard } from '@/components/stats/stats-card';
import { RunStatusBadge } from '@/components/runs/run-status-badge';
import { NewRunDialog } from '@/components/runs/new-run-dialog';
import type { BreakdownResult, BreakdownRow } from '@/app/api/stats/breakdown/route';
import type { TrendPoint } from '@/app/api/stats/trend/route';

interface Summary {
  running: number;
  queued: number;
  completed24h: number;
  failed24h: number;
  totalItems: number;
  newItems24h: number;
}

// ── 平台 / kind 颜色 ──────────────────────────────────────────────────────────

const PLATFORM_COLOR: Record<string, string> = {
  youtube: 'bg-red-400',
  bilibili: 'bg-blue-400',
  xhs: 'bg-rose-400',
  未知: 'bg-gray-300',
};

const KIND_COLOR: Record<string, string> = {
  video: 'bg-purple-400',
  article: 'bg-blue-400',
  audio: 'bg-green-400',
  image: 'bg-yellow-400',
  post: 'bg-orange-400',
  未知: 'bg-gray-300',
};

// ── BarChart — 横向条形图 ─────────────────────────────────────────────────────

function BarChart({ rows, colorMap }: { rows: BreakdownRow[]; colorMap: Record<string, string> }) {
  if (rows.length === 0)
    return <p className="py-4 text-center text-xs text-muted-foreground">暂无数据</p>;

  const max = Math.max(...rows.map((r) => r.count), 1);

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2 text-sm">
          <span className="w-28 shrink-0 truncate text-right text-xs text-muted-foreground">
            {row.label}
          </span>
          <div className="relative flex-1 rounded-full bg-muted/50">
            <div
              className={`h-5 rounded-full transition-all ${colorMap[row.label] ?? 'bg-gray-400'}`}
              style={{ width: `${Math.max((row.count / max) * 100, 2)}%` }}
            />
          </div>
          <span className="w-12 shrink-0 text-right text-xs font-medium tabular-nums">
            {row.count.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── TrendChart — 近 7 日趋势条形图 ────────────────────────────────────────────

function TrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0)
    return <p className="py-4 text-center text-xs text-muted-foreground">暂无数据</p>;

  const max = Math.max(...points.map((p) => p.count), 1);

  return (
    <div className="flex h-28 items-end gap-1">
      {points.map((p) => {
        const pct = Math.max((p.count / max) * 100, p.count > 0 ? 4 : 0);
        const label = p.date.slice(5); // "MM-DD"
        return (
          <div key={p.date} className="group relative flex flex-1 flex-col items-center gap-1">
            <div
              className="w-full rounded-t bg-primary/70 transition-all group-hover:bg-primary"
              style={{ height: `${pct}%` }}
              title={`${p.date}: ${p.count.toLocaleString()} 条`}
            />
            <span className="text-[10px] text-muted-foreground">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── DashboardPage ─────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: summary } = useQuery({
    queryKey: ['stats', 'summary'],
    queryFn: () => api.get<Summary>('/api/stats/summary'),
    refetchInterval: 5_000,
  });

  const { data: active } = useQuery({
    queryKey: ['runs', 'active'],
    queryFn: () => api.get<ListResult<Run>>('/api/runs?status=running,queued&pageSize=10'),
    refetchInterval: 5_000,
  });

  const { data: recent } = useQuery({
    queryKey: ['runs', 'recent'],
    queryFn: () =>
      api.get<ListResult<Run>>('/api/runs?status=completed,failed,stopped&pageSize=10'),
    refetchInterval: 10_000,
  });

  const { data: breakdown } = useQuery({
    queryKey: ['stats', 'breakdown'],
    queryFn: () => api.get<BreakdownResult>('/api/stats/breakdown'),
    refetchInterval: 30_000,
  });

  const { data: trend } = useQuery({
    queryKey: ['stats', 'trend'],
    queryFn: () => api.get<TrendPoint[]>('/api/stats/trend?days=7'),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6">
      {/* 顶部统计卡 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatsCard label="运行中" value={summary?.running ?? '—'} />
        <StatsCard label="排队" value={summary?.queued ?? '—'} />
        <StatsCard label="今日完成" value={summary?.completed24h ?? '—'} hint="过去 24h" />
        <StatsCard label="今日失败" value={summary?.failed24h ?? '—'} hint="过去 24h" />
        <StatsCard label="总条目" value={summary?.totalItems ?? '—'} />
        <StatsCard label="新增条目" value={summary?.newItems24h ?? '—'} hint="过去 24h" />
      </div>

      {/* 数据分布 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>平台分布</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart rows={breakdown?.byPlatform ?? []} colorMap={PLATFORM_COLOR} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>内容类型分布</CardTitle>
          </CardHeader>
          <CardContent>
            <BarChart rows={breakdown?.byKind ?? []} colorMap={KIND_COLOR} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>近 7 日新增趋势</CardTitle>
          </CardHeader>
          <CardContent>
            <TrendChart points={trend ?? []} />
          </CardContent>
        </Card>
      </div>

      {/* 当前运行 */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>当前运行</CardTitle>
          <NewRunDialog trigger={<Button size="sm">+ 新建运行</Button>} />
        </CardHeader>
        <CardContent>
          {active?.data.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              暂无运行中或排队的任务
            </div>
          ) : (
            <ul className="divide-y">
              {active?.data.map((r) => (
                <li key={r.id} className="flex items-center gap-4 py-3">
                  <RunStatusBadge status={r.status} />
                  <Link
                    href={`/runs/${r.id}`}
                    className="flex-1 truncate font-mono text-sm hover:underline"
                  >
                    {r.spiderName} · {r.id.slice(0, 8)}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    fetched {r.fetched} · errors {r.errors}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 最近完成 */}
      <Card>
        <CardHeader>
          <CardTitle>最近完成</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {recent?.data.map((r) => (
              <li key={r.id} className="flex items-center gap-4 py-3">
                <RunStatusBadge status={r.status} />
                <Link
                  href={`/runs/${r.id}`}
                  className="flex-1 truncate font-mono text-sm hover:underline"
                >
                  {r.spiderName} · {r.id.slice(0, 8)}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {r.fetched} fetched · {r.newItems} new · {r.errors} err
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
