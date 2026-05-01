'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Attachment } from '@/lib/db';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const STATUS_OPTIONS = [
  { key: 'all', label: '全部' },
  { key: 'queued', label: '排队中' },
  { key: 'downloading', label: '下载中' },
  { key: 'transcoding', label: '转码中' },
  { key: 'completed', label: '已完成' },
  { key: 'failed', label: '失败' },
] as const;

const STATUS_BADGE: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-700',
  downloading: 'bg-blue-100 text-blue-800',
  transcoding: 'bg-purple-100 text-purple-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-700',
};

interface ListResult {
  data: (Attachment & { itemId: number })[];
  total: number;
  page: number;
  pageSize: number;
}

function fmtBytes(n: number | null): string {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
}

export default function AttachmentsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]['key']>('all');
  const [spider, setSpider] = useState('');
  const [page, setPage] = useState(1);
  const [gcDays, setGcDays] = useState('7');

  const params = new URLSearchParams({ page: String(page), pageSize: '30' });
  if (status !== 'all') params.set('status', status);
  if (spider.trim()) params.set('spider', spider.trim());

  const { data, isLoading } = useQuery({
    queryKey: ['attachments', status, spider, page],
    queryFn: () => api.get<ListResult>(`/api/attachments?${params.toString()}`),
    refetchInterval: status === 'downloading' || status === 'queued' ? 5000 : false,
  });

  const retry = useMutation({
    mutationFn: (id: string) => api.post<{ retried: boolean }>(`/api/attachments/${id}/retry`),
    onSuccess: () => {
      toast.success('已重新入队');
      void qc.invalidateQueries({ queryKey: ['attachments'] });
    },
    onError: (err) => toast.error(`重试失败：${String(err)}`),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted: boolean }>(`/api/attachments/${id}`),
    onSuccess: () => {
      toast.success('已删除');
      void qc.invalidateQueries({ queryKey: ['attachments'] });
    },
    onError: (err) => toast.error(`删除失败：${String(err)}`),
  });

  const gc = useMutation({
    mutationFn: () =>
      api.post<{ deleted: number; olderThanDays: number }>(`/api/attachments/gc`, {
        olderThanDays: Math.max(0, Number(gcDays) || 0),
      }),
    onSuccess: ({ deleted, olderThanDays }) => {
      toast.success(`已清理 ${deleted} 条 ${olderThanDays} 天前的失败下载`);
      void qc.invalidateQueries({ queryKey: ['attachments'] });
    },
    onError: (err) => toast.error(`清理失败：${String(err)}`),
  });

  const onGc = () => {
    if (window.confirm(`清理 ${gcDays} 天前所有 status=failed 的附件？（含磁盘文件）`)) {
      gc.mutate();
    }
  };

  const list = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / 30));

  return (
    <div className="space-y-4">
      {/* 顶部工具条 */}
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => {
              setStatus(o.key);
              setPage(1);
            }}
            className={`rounded-full border px-3 py-1 text-xs ${
              status === o.key
                ? 'border-foreground bg-foreground text-background'
                : 'hover:bg-muted'
            }`}
          >
            {o.label}
          </button>
        ))}
        <Input
          placeholder="按 spider 过滤…"
          value={spider}
          onChange={(e) => {
            setSpider(e.target.value);
            setPage(1);
          }}
          className="ml-2 h-8 w-48"
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">清理</span>
          <Input
            type="number"
            min={0}
            max={365}
            value={gcDays}
            onChange={(e) => setGcDays(e.target.value)}
            className="h-8 w-16"
          />
          <span className="text-xs text-muted-foreground">天前 failed</span>
          <Button size="sm" variant="outline" onClick={onGc} disabled={gc.isPending}>
            {gc.isPending ? '...' : 'GC'}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead>Spider</TableHead>
                <TableHead>Kind / Fetcher</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>来源 URL</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && list.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    暂无附件
                  </TableCell>
                </TableRow>
              )}
              {list.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>
                    <Link
                      href={`/items/${String(a.itemId)}`}
                      className="font-mono text-xs hover:underline"
                    >
                      #{a.itemId}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{a.spider}</TableCell>
                  <TableCell className="text-xs">
                    <span className="rounded bg-muted px-1.5 py-0.5">{a.kind}</span>
                    <span className="ml-1 text-muted-foreground">{a.fetcherKind}</span>
                    {a.transcodeOp && (
                      <span className="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">
                        {a.transcodeOp}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[a.status] ?? 'bg-gray-100 text-gray-700'}`}
                    >
                      {a.status}
                      {a.progressPct != null && a.status !== 'completed' && (
                        <span className="ml-1 tabular-nums">· {a.progressPct}%</span>
                      )}
                    </span>
                    {a.errorMessage && (
                      <p
                        className="mt-1 max-w-xs truncate text-xs text-red-600"
                        title={a.errorMessage}
                      >
                        ⚠ {a.errorMessage}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">{fmtBytes(a.byteSize)}</TableCell>
                  <TableCell className="max-w-xs truncate text-xs" title={a.sourceUrl}>
                    {a.sourceUrl}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {a.status === 'completed' && (
                        <Button asChild size="sm" variant="outline">
                          <a href={`/api/attachments/${a.id}/download`}>下载</a>
                        </Button>
                      )}
                      {a.status === 'failed' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => retry.mutate(a.id)}
                          disabled={retry.isPending}
                        >
                          重试
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-600 hover:text-red-700"
                        onClick={() => {
                          if (window.confirm('删除该附件（含磁盘文件）？')) remove.mutate(a.id);
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* 分页 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            共 {total} 条 · 第 {page} / {totalPages} 页
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
