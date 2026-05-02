'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Link2,
  Loader2,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import { api, type ListResult } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { inspect, type InspectResult } from '@/lib/crawler/extractors/inspect';
import type { ExtractJob, ExtractUrlResult, Item } from '@/lib/db';

interface ExtractResponse {
  jobId: string;
  accepted: number;
  rejected: { url: string; reason: string; host?: string }[];
}

interface JobDetail {
  job: ExtractJob;
  items: Item[];
}

// ──────────────────────────────────────────────────────────
// 输入行：每行独立 id，便于增删
// ──────────────────────────────────────────────────────────

interface InputRow {
  id: string;
  value: string;
}

function makeRow(value = ''): InputRow {
  return { id: crypto.randomUUID(), value };
}

function statusBadge(r: InspectResult) {
  if (r.kind === 'invalid') {
    if (r.rawUrl.length === 0) return null;
    return <Badge variant="destructive">无效链接</Badge>;
  }
  if (r.kind === 'unsupported') {
    return <Badge variant="warning">不支持 · {r.host}</Badge>;
  }
  return <Badge variant="success">{r.platform}</Badge>;
}

// ──────────────────────────────────────────────────────────
// 主页面
// ──────────────────────────────────────────────────────────

export default function ExtractPage() {
  const qc = useQueryClient();
  const [rows, setRows] = useState<InputRow[]>([makeRow()]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // 每行的 inspect 结果（按 value 现算，无需缓存）
  const inspections = useMemo(
    () => rows.map((r) => ({ row: r, result: inspect(r.value) })),
    [rows],
  );

  const supportedCount = inspections.filter((x) => x.result.kind === 'supported').length;

  // 提交 ────────────────────────────────────────────────────
  const submit = useMutation({
    mutationFn: (urls: string[]) => api.post<ExtractResponse>('/api/extract', { urls }),
    onSuccess: (res) => {
      setActiveJobId(res.jobId);
      // 把已提交的行清空，但保留一个空行作为下次输入起点
      setRows([makeRow()]);
      void qc.invalidateQueries({ queryKey: ['extract-jobs'] });
      if (res.rejected.length > 0) {
        toast.warning(`已提交 ${String(res.accepted)} 条，跳过 ${String(res.rejected.length)} 条`);
      } else {
        toast.success(`已提交 ${String(res.accepted)} 条 URL`);
      }
    },
    onError: (err: Error) => {
      toast.error(`提交失败：${err.message}`);
    },
  });

  // 历史列表（每 5 秒刷新一次，捕捉运行中批次的进度变化） ─────
  const history = useQuery({
    queryKey: ['extract-jobs', { page: 1, pageSize: 20 }],
    queryFn: () => api.get<ListResult<ExtractJob>>('/api/extract-jobs?page=1&pageSize=20'),
    refetchInterval: (q) => {
      const data = q.state.data;
      if (!data) return false;
      // 如有 running 批次，1.5s 轮询；否则关闭
      return data.data.some((j) => j.status === 'running') ? 1500 : false;
    },
  });

  // 行操作 ─────────────────────────────────────────────────
  const updateRow = (id: string, value: string): void => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, value } : r)));
  };
  const removeRow = (id: string): void => {
    setRows((prev) => (prev.length === 1 ? [makeRow()] : prev.filter((r) => r.id !== id)));
  };
  const addRow = (): void => {
    setRows((prev) => [...prev, makeRow()]);
  };

  // 粘贴：若粘贴内容含换行/逗号，自动拆成多行填充
  const handlePaste = (rowId: string, e: React.ClipboardEvent<HTMLInputElement>): void => {
    const text = e.clipboardData.getData('text');
    if (!/[\n\r,]/.test(text)) return; // 普通粘贴
    e.preventDefault();
    const parts = text
      .split(/[\n\r,]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (parts.length === 0) return;
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === rowId);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx]!, value: parts[0]! };
      const inserts = parts.slice(1).map((v) => makeRow(v));
      next.splice(idx + 1, 0, ...inserts);
      return next;
    });
  };

  const handleSubmit = (): void => {
    const urls = inspections
      .filter((x) => x.result.kind === 'supported')
      .map((x) => x.result.rawUrl);
    if (urls.length === 0) {
      toast.error('请至少添加一条受支持的链接');
      return;
    }
    if (urls.length > 50) {
      toast.error('单次最多 50 条');
      return;
    }
    submit.mutate(urls);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">快取</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          逐条输入或粘贴链接，命中已注册平台才会下发执行；不支持的域名会标灰跳过
        </p>
      </div>

      {/* 输入区 */}
      <Card>
        <CardContent className="space-y-2 pt-4">
          {inspections.map(({ row, result }, idx) => (
            <div key={row.id} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">
                {idx + 1}
              </span>
              <Input
                placeholder="https://www.youtube.com/watch?v=..."
                value={row.value}
                onChange={(e) => {
                  updateRow(row.id, e.target.value);
                }}
                onPaste={(e) => {
                  handlePaste(row.id, e);
                }}
                disabled={submit.isPending}
                className="font-mono"
              />
              <div className="w-32 shrink-0">{statusBadge(result)}</div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  removeRow(row.id);
                }}
                disabled={submit.isPending}
                aria-label="删除"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={addRow} disabled={submit.isPending}>
              <Plus className="mr-1 h-4 w-4" /> 添加一行
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard
                  .readText()
                  .then((text) => {
                    if (!text) return;
                    const parts = text
                      .split(/[\n\r,]+/)
                      .map((s) => s.trim())
                      .filter(Boolean);
                    if (parts.length === 0) {
                      toast.error('剪贴板为空');
                      return;
                    }
                    setRows(parts.map((v) => makeRow(v)));
                  })
                  .catch(() => toast.error('读取剪贴板失败'));
              }}
              disabled={submit.isPending}
            >
              <Clipboard className="mr-1 h-4 w-4" /> 从剪贴板填充
            </Button>
            <div className="ml-auto flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                有效 <strong>{supportedCount}</strong> / 共{' '}
                {rows.filter((r) => r.value.trim()).length}
              </span>
              <Button onClick={handleSubmit} disabled={submit.isPending || supportedCount === 0}>
                {submit.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 提交中…
                  </>
                ) : (
                  <>
                    <Link2 className="mr-2 h-4 w-4" /> 开始抓取
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 历史区 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">历史记录</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {history.isLoading && (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
            </div>
          )}
          {history.data && history.data.data.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">还没有快取记录</div>
          )}
          <div className="divide-y">
            {history.data?.data.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                expanded={activeJobId === job.id}
                onToggle={() => {
                  setActiveJobId(activeJobId === job.id ? null : job.id);
                }}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// 单条历史记录（带展开详情）
// ──────────────────────────────────────────────────────────

function JobRow({
  job,
  expanded,
  onToggle,
}: {
  job: ExtractJob;
  expanded: boolean;
  onToggle: () => void;
}) {
  const detail = useQuery({
    queryKey: ['extract-job-detail', job.id],
    queryFn: () => api.get<JobDetail>(`/api/extract-jobs/${job.id}`),
    enabled: expanded,
    refetchInterval: () => (job.status === 'running' ? 1500 : false),
  });

  const created = new Date(job.createdAt);
  const created_str = `${String(created.getMonth() + 1)}/${String(created.getDate())} ${String(
    created.getHours(),
  ).padStart(2, '0')}:${String(created.getMinutes()).padStart(2, '0')}`;

  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/50"
        onClick={onToggle}
      >
        <span className="shrink-0">
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="text-sm tabular-nums text-muted-foreground">{created_str}</span>
          {job.status === 'running' ? (
            <Badge variant="info" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" /> 运行中
            </Badge>
          ) : (
            <Badge variant="secondary">已完成</Badge>
          )}
          <span className="text-sm">
            <strong>{job.succeeded}</strong>
            <span className="text-muted-foreground"> / {job.total} 成功</span>
            {job.failed > 0 && <span className="ml-2 text-destructive">{job.failed} 失败</span>}
          </span>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          共提交 {job.submittedUrls.length} 条
        </span>
      </button>

      {expanded && (
        <div className="border-t bg-muted/30 px-4 py-3">
          {detail.isLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载详情…
            </div>
          )}
          {detail.data && <JobDetailView detail={detail.data} resultsMap={job.results} />}
        </div>
      )}
    </div>
  );
}

function JobDetailView({
  detail,
  resultsMap,
}: {
  detail: JobDetail;
  resultsMap: Record<string, ExtractUrlResult>;
}) {
  // 把 resultsMap (canonicalUrl → ExtractUrlResult) 与 items（按 url 匹配 canonicalUrl）对齐
  const itemsByUrl = useMemo(() => {
    const m = new Map<string, Item>();
    for (const it of detail.items) m.set(it.url, it);
    return m;
  }, [detail.items]);

  const entries = Object.entries(resultsMap);

  return (
    <div className="space-y-1">
      {entries.map(([canonical, r]) => {
        const item = itemsByUrl.get(canonical);
        const thumb = pickThumb(item);
        return (
          <div key={canonical} className="flex items-center gap-3 rounded px-2 py-2">
            <div className="shrink-0">
              {r.status === 'pending' && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {r.status === 'succeeded' && <CheckCircle className="h-4 w-4 text-green-600" />}
              {r.status === 'failed' && <XCircle className="h-4 w-4 text-red-500" />}
            </div>
            {thumb && (
              <img src={thumb} alt="" className="h-10 w-16 shrink-0 rounded object-cover" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {(item?.payload as { title?: string } | undefined)?.title ?? r.originalUrl}
              </p>
              <a
                href={r.originalUrl}
                target="_blank"
                rel="noreferrer"
                className="truncate text-xs text-muted-foreground hover:underline"
              >
                {r.originalUrl}
              </a>
              {r.status === 'failed' && (
                <p className="mt-0.5 text-xs text-destructive">
                  {r.errorCode}: {r.errorMessage}
                </p>
              )}
            </div>
            <Badge variant="outline" className="shrink-0">
              {r.platform}
            </Badge>
            {item && (
              <a
                href={`/data/${String(item.id)}`}
                className="shrink-0 text-xs text-muted-foreground hover:underline"
              >
                详情 →
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}

function pickThumb(item: Item | undefined): string | null {
  if (!item) return null;
  const media = (item.payload as { media?: { kind?: string; url?: string }[] } | undefined)?.media;
  return media?.find((m) => m.kind === 'thumbnail')?.url ?? null;
}
