'use client';
import React, { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Run, Spider } from '@/lib/db';
import { api } from '@/lib/api-client';
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
    name: spider.name,
    displayName: spider.displayName,
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
  a.download = `spider-${spider.name}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

interface ListResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

function fmtDuration(start: string | null, end: string | null): string {
  if (!start) return '—';
  const ms = (end ? new Date(end) : new Date()).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

export default function SpiderDetailPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params);
  const queryClient = useQueryClient();

  const { data: spider, isLoading } = useQuery({
    queryKey: ['spider', name],
    queryFn: () => api.get<Spider>(`/api/spiders/${name}`),
  });

  // 重置 visited：删除该 spider 在 visited 表的所有记录，
  // 让下次 run 不再因为指纹命中被跳过。常用于 list/search 类 URL 被锁住的情形。
  const resetVisitedMutation = useMutation({
    mutationFn: () => api.delete<{ deleted: number }>(`/api/spiders/${name}/visited`),
    onSuccess: ({ deleted }) => {
      toast.success(`已重置 visited（删除 ${deleted} 条记录）`);
      void queryClient.invalidateQueries({ queryKey: ['runs', 'spider', name] });
    },
    onError: (err) => toast.error(`重置失败：${String(err)}`),
  });

  // 切换 autoDownload：抓取完成后是否自动派发附件下载
  const toggleAutoDownloadMutation = useMutation({
    mutationFn: (next: boolean) => {
      if (!spider) throw new Error('spider not loaded');
      // PUT 是全量更新，必须把所有现有字段透传，否则会被 schema 默认值覆盖。
      return api.put<Spider>(`/api/spiders/${name}`, {
        displayName: spider.displayName,
        description: spider.description,
        startUrls: spider.startUrls,
        allowedHosts: spider.allowedHosts,
        maxDepth: spider.maxDepth,
        concurrency: spider.concurrency,
        perHostIntervalMs: spider.perHostIntervalMs,
        enabled: spider.enabled,
        cronSchedule: spider.cronSchedule,
        platform: spider.platform,
        defaultParams: spider.defaultParams,
        autoDownload: next,
      });
    },
    onSuccess: (_, next) => {
      toast.success(next ? '已开启自动下载' : '已关闭自动下载');
      void queryClient.invalidateQueries({ queryKey: ['spider', name] });
    },
    onError: (err) => toast.error(`保存失败：${String(err)}`),
  });

  const onResetVisited = () => {
    if (
      window.confirm(
        `确定要清空 spider "${name}" 的所有 visited 记录吗？\n\n清空后，下次运行会重新抓取所有曾抓过的 URL（包括看似"已完成"的种子页）。\n\n仅在你怀疑 visited 表把 URL 锁住、导致后续 run 空跑时使用。`,
      )
    ) {
      resetVisitedMutation.mutate();
    }
  };

  const { data: runsResult } = useQuery({
    queryKey: ['runs', 'spider', name],
    queryFn: () =>
      api.get<ListResult<Run>>(`/api/runs?spider=${encodeURIComponent(name)}&pageSize=10`),
    refetchInterval: 10_000,
  });

  const { data: allRunsResult } = useQuery({
    queryKey: ['runs', 'spider', name, 'all'],
    queryFn: () =>
      api.get<ListResult<Run>>(`/api/runs?spider=${encodeURIComponent(name)}&pageSize=1000`),
  });

  const { data: itemsResult } = useQuery({
    queryKey: ['items', 'spider', name, 'count'],
    queryFn: () =>
      api.get<ListResult<unknown>>(`/api/items?spider=${encodeURIComponent(name)}&pageSize=1`),
  });

  if (isLoading) return <div>加载中…</div>;
  if (!spider) return <div>未找到 Spider：{name}</div>;

  // ── 聚合统计 ──────────────────────────────────────────────────────────────
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
          <h1 className="text-xl font-semibold">{spider.displayName}</h1>
          <p className="font-mono text-sm text-muted-foreground">{spider.name}</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={spider.autoDownload ? 'destructive' : 'default'}
            onClick={() => toggleAutoDownloadMutation.mutate(!spider.autoDownload)}
            disabled={toggleAutoDownloadMutation.isPending}
            title={
              spider.autoDownload
                ? '关闭后，下次 run 完成不会自动派发附件下载（手动仍可触发）'
                : '开启后，每次 run 完成都会扫描产出 item 并派发可下载附件'
            }
          >
            {toggleAutoDownloadMutation.isPending
              ? '...'
              : spider.autoDownload
                ? '关闭自动下载'
                : '开启自动下载'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onResetVisited}
            disabled={resetVisitedMutation.isPending}
            title="清空该 spider 的 visited 记录，强制下次 run 重新抓取所有 URL"
          >
            {resetVisitedMutation.isPending ? '重置中…' : '重置 visited'}
          </Button>
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
              href={`/runs?spider=${encodeURIComponent(name)}`}
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
              ['autoDownload', spider.autoDownload ? '✓ 抓取后自动下载附件' : '— 仅抓元数据'],
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
