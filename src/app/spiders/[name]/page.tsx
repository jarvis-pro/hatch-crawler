'use client';
import React, { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { Run, Spider } from '@/lib/db';
import { api, type ListResult } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RunStatusBadge } from '@/components/runs/run-status-badge';
import { StatsCard } from '@/components/stats/stats-card';

/** 导出 Spider 配置为 JSON 文件 */
function exportSpiderConfig(spider: Spider) {
  const config = {
    type: spider.type,
    name: spider.name,
    description: spider.description,
    platform: spider.platform,
    startUrls: spider.startUrls,
    allowedHosts: spider.allowedHosts,
    maxDepth: spider.maxDepth,
    concurrency: spider.concurrency,
    perHostIntervalMs: spider.perHostIntervalMs,
    enabled: spider.enabled,
    cronSchedule: spider.cronSchedule,
    defaultParams: spider.defaultParams,
  };
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `spider-${spider.type}-${spider.id.slice(0, 8)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start) return '—';
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

/**
 * Spider 详情页。
 * 路由参数 `name` 实际存放的是 spiders.id（UUID）。
 * 文件夹保留 [name] 命名以避免文件系统限制，等可手动清理旧目录时再重命名。
 */
export default function SpiderDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name: id } = use(params);

  const { data: spider, isLoading } = useQuery({
    queryKey: ['spider', id],
    queryFn: () => api.get<Spider>(`/api/spiders/${id}`),
  });

  const { data: runsResult } = useQuery({
    queryKey: ['runs', 'spider', id],
    queryFn: () =>
      api.get<ListResult<Run>>(`/api/runs?spiderId=${encodeURIComponent(id)}&pageSize=10`),
    refetchInterval: 10_000,
  });

  const { data: allRunsResult } = useQuery({
    queryKey: ['runs', 'spider', id, 'all'],
    queryFn: () =>
      api.get<ListResult<Run>>(`/api/runs?spiderId=${encodeURIComponent(id)}&pageSize=1000`),
  });

  const { data: itemsResult } = useQuery({
    queryKey: ['items', 'spider', id, 'count'],
    queryFn: () =>
      api.get<ListResult<unknown>>(
        `/api/items?spider=${encodeURIComponent(spider?.type ?? '')}&pageSize=1`,
      ),
    enabled: !!spider,
  });

  if (isLoading) return <div>加载中…</div>;
  if (!spider) return <div>未找到 Spider：{id}</div>;

  const allRuns = allRunsResult?.data ?? [];
  const totalRuns = allRunsResult?.total ?? 0;
  const completedRuns = allRuns.filter((r) => r.status === 'completed').length;
  const successRate = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : null;
  const totalItems = itemsResult?.total ?? 0;
  const totalNewItems = allRuns.reduce((s, r) => s + (r.newItems ?? 0), 0);
  const recentRuns = runsResult?.data ?? [];

  return (
    <div className="space-y-6">
      {/* ── 标题栏 ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{spider.name}</h1>
          <p className="font-mono text-sm text-muted-foreground">{spider.type}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => exportSpiderConfig(spider)}>
            导出配置
          </Button>
        </div>
      </div>

      {/* ── 统计卡片 ── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatsCard label="总运行次数" value={totalRuns} />
        <StatsCard label="成功率" value={successRate !== null ? `${successRate}%` : '—'} />
        <StatsCard label="累计抓取条目" value={totalItems} />
        <StatsCard label="累计新增条目" value={totalNewItems} />
      </div>

      {/* ── 近期运行 ── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            近期运行
            <Link
              href={`/runs?spiderId=${encodeURIComponent(id)}`}
              className="text-xs font-normal text-muted-foreground hover:underline"
            >
              查看全部 →
            </Link>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>fetched / new / err</TableHead>
                <TableHead>耗时</TableHead>
                <TableHead>时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentRuns.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    暂无运行记录
                  </TableCell>
                </TableRow>
              )}
              {recentRuns.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/runs/${r.id}`} className="hover:underline">
                      {r.id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <RunStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.fetched} / {r.newItems} / {r.errors}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {fmtDuration(
                      r.startedAt ? String(r.startedAt) : null,
                      r.finishedAt ? String(r.finishedAt) : null,
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── 配置详情 ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">配置</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {[
              ['平台', spider.platform ?? '—'],
              ['maxDepth', String(spider.maxDepth ?? '—')],
              ['concurrency', String(spider.concurrency ?? '—')],
              [
                'perHostIntervalMs',
                spider.perHostIntervalMs ? `${spider.perHostIntervalMs}ms` : '—',
              ],
              ['cronSchedule', spider.cronSchedule ?? '—'],
              ['enabled', spider.enabled ? '✓ 启用' : '— 禁用'],
            ].map(([label, val]) => (
              <React.Fragment key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono">{val}</dd>
              </React.Fragment>
            ))}
            {spider.startUrls.length > 0 && (
              <>
                <dt className="text-muted-foreground">startUrls</dt>
                <dd>
                  <ul className="space-y-0.5">
                    {spider.startUrls.map((u) => (
                      <li key={u} className="truncate font-mono text-xs">
                        {u}
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
