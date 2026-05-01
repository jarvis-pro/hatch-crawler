'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Run } from '@/lib/db';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { RunStatusBadge } from '@/components/runs/run-status-badge';

interface ListResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

const PAGE_SIZE = 30;

const STATUS_OPTIONS = [
  { value: '', label: '全部' },
  { value: 'running', label: '运行中' },
  { value: 'queued', label: '排队中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'stopped', label: '已停止' },
];

function fmtDuration(start: string | null, end: string | null): string {
  if (!start) return '—';
  const s = new Date(start);
  const e = end ? new Date(end) : new Date();
  const ms = e.getTime() - s.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.round((ms % 60_000) / 1000)}s`;
}

export default function RunsPage() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  function buildQuery() {
    const p = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (status) p.set('status', status);
    return `/api/runs?${p.toString()}`;
  }

  const { data, isLoading } = useQuery({
    queryKey: ['runs', 'list', status, page],
    queryFn: () => api.get<ListResult<Run>>(buildQuery()),
    refetchInterval: 5_000,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="space-y-4">
      {/* ── 筛选栏 ── */}
      <div className="flex items-center gap-2">
        <div className="flex rounded-md border">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setStatus(opt.value);
                setPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-medium transition-colors first:rounded-l-md last:rounded-r-md ${
                status === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="flex-1 text-sm text-muted-foreground">共 {data?.total ?? 0} 条</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Spider</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>fetched / new / err</TableHead>
                <TableHead>耗时</TableHead>
                <TableHead>创建时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              )}
              {data?.data.length === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    暂无运行记录。
                  </TableCell>
                </TableRow>
              )}
              {data?.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/runs/${r.id}`} className="hover:underline">
                      {r.id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">{r.spiderName}</TableCell>
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

      {/* ── 翻页控件 ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ‹ 上一页
          </Button>
          <span className="text-sm text-muted-foreground">
            第 {page} / {totalPages} 页
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页 ›
          </Button>
        </div>
      )}
    </div>
  );
}
