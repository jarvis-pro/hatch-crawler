'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Run, Spider } from '@/lib/db';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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

/** 是否为终态（可删除） */
function isTerminal(status: string) {
  return status === 'completed' || status === 'failed' || status === 'stopped';
}

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
  const searchParams = useSearchParams();
  const qc = useQueryClient();

  const [spiderId, setSpiderId] = useState(() => searchParams.get('spiderId') ?? '');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // URL 参数变化时同步（如浏览器后退到带 ?spiderId= 的 URL）
  useEffect(() => {
    const s = searchParams.get('spiderId') ?? '';
    setSpiderId(s);
    setPage(1);
    setSelected(new Set());
  }, [searchParams]);

  function buildQuery(overridePage?: number) {
    const p = new URLSearchParams({
      page: String(overridePage ?? page),
      pageSize: String(PAGE_SIZE),
    });
    if (status) p.set('status', status);
    if (spiderId) p.set('spiderId', spiderId);
    return `/api/runs?${p.toString()}`;
  }

  const { data, isLoading } = useQuery({
    queryKey: ['runs', 'list', status, spiderId, page],
    queryFn: () => api.get<ListResult<Run>>(buildQuery()),
    refetchInterval: 5_000,
  });

  // 加载已注册的 spider 列表用于下拉选择
  const { data: spiders = [] } = useQuery({
    queryKey: ['spiders'],
    queryFn: () => api.get<Spider[]>('/api/spiders'),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  // ── 勾选逻辑（仅终态 run 可勾选）────────────────────────────────────────────
  const currentIds = (data?.data ?? []).filter((r) => isTerminal(r.status)).map((r) => r.id);
  const allOnPageSelected = currentIds.length > 0 && currentIds.every((id) => selected.has(id));

  function toggleSelectAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        currentIds.forEach((id) => next.delete(id));
      } else {
        currentIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── 批量删除 ──────────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.delete<{ deleted: number }>('/api/runs', { ids }),
    onSuccess: (res) => {
      toast.success(`已删除 ${res.deleted} 条运行记录`);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ['runs'] });
    },
    onError: (err: Error) => {
      toast.error(`删除失败：${err.message}`);
    },
  });

  function handleDeleteSelected() {
    if (selected.size === 0) return;
    setShowDeleteConfirm(true);
  }

  function resetPage() {
    setPage(1);
    setSelected(new Set());
  }

  return (
    <>
      <div className="space-y-4">
        {/* ── 筛选栏 ── */}
        <div className="flex flex-wrap items-center gap-2">
          {/* 状态筛选 */}
          <div className="flex rounded-md border">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setStatus(opt.value);
                  resetPage();
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

          {/* Spider 下拉筛选 */}
          <select
            value={spiderId}
            onChange={(e) => {
              setSpiderId(e.target.value);
              resetPage();
            }}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-xs shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">所有 Spider</option>
            {spiders.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* 清除 Spider 筛选 */}
          {spiderId && (
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSpiderId('');
                resetPage();
              }}
            >
              ✕ 清除 Spider 筛选
            </button>
          )}

          <span className="flex-1 text-sm text-muted-foreground">共 {data?.total ?? 0} 条</span>

          {/* 批量操作（有选中时显示） */}
          {selected.size > 0 && (
            <>
              <span className="text-sm font-medium text-muted-foreground">
                已选 {selected.size} 条
              </span>
              <Button
                size="sm"
                variant="destructive"
                disabled={deleteMutation.isPending}
                onClick={handleDeleteSelected}
              >
                {deleteMutation.isPending ? '删除中…' : `删除 ${selected.size} 条`}
              </Button>
            </>
          )}
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 cursor-pointer rounded border-gray-300"
                      aria-label="全选当前页终态记录"
                      title="全选当前页可删除的记录（运行中 / 排队中不可选）"
                    />
                  </TableHead>
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
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      加载中…
                    </TableCell>
                  </TableRow>
                )}
                {data?.data.length === 0 && !isLoading && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      暂无运行记录。
                    </TableCell>
                  </TableRow>
                )}
                {data?.data.map((r) => {
                  const terminal = isTerminal(r.status);
                  const checked = selected.has(r.id);
                  return (
                    <TableRow key={r.id} className={checked ? 'bg-muted/40' : undefined}>
                      <TableCell>
                        {terminal ? (
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleOne(r.id)}
                            className="h-4 w-4 cursor-pointer rounded border-gray-300"
                            aria-label={`选择 run ${r.id.slice(0, 8)}`}
                          />
                        ) : (
                          <span className="inline-block h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        <Link href={`/runs/${r.id}`} className="hover:underline">
                          {r.id.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.spiderId ? (
                          <Link href={`/spiders/${r.spiderId}`} className="hover:underline">
                            {r.spiderName}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{r.spiderName}</span>
                        )}
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
                  );
                })}
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
              onClick={() => {
                setPage((p) => p - 1);
                setSelected(new Set());
              }}
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
              onClick={() => {
                setPage((p) => p + 1);
                setSelected(new Set());
              }}
            >
              下一页 ›
            </Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={showDeleteConfirm}
        title="删除运行记录"
        description={`确定删除选中的 ${selected.size} 条运行记录？相关事件日志也会一并删除，此操作不可撤销。`}
        confirmText="确认删除"
        danger
        isPending={deleteMutation.isPending}
        onConfirm={() => {
          deleteMutation.mutate([...selected]);
          setShowDeleteConfirm(false);
        }}
        onClose={() => setShowDeleteConfirm(false)}
      />
    </>
  );
}
