'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RefreshCw, Layers, Link2, ImageOff, type LucideIcon } from 'lucide-react';
import type { Item } from '@/lib/db';
import { api, type ListResult } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';


const PAGE_SIZE = 50;

const KIND_LABELS: Record<string, string> = {
  article: '文章',
  video: '视频',
  audio: '音频',
  image: '图片',
  post: '短帖',
  comment: '评论',
};

const KIND_COLORS: Record<string, string> = {
  article: 'bg-blue-100 text-blue-800',
  video: 'bg-purple-100 text-purple-800',
  audio: 'bg-green-100 text-green-800',
  image: 'bg-yellow-100 text-yellow-800',
  post: 'bg-orange-100 text-orange-800',
  comment: 'bg-pink-100 text-pink-800',
};

// ── 导出工具 ──────────────────────────────────────────────────────────────────

const EXPORT_COLUMNS = [
  { key: 'id', label: 'ID' },
  { key: 'platform', label: '平台' },
  { key: 'kind', label: '类型' },
  { key: 'spider', label: 'Spider' },
  { key: 'url', label: 'URL' },
  { key: 'sourceId', label: '来源 ID' },
  { key: 'title', label: '标题' },
  { key: 'description', label: '简介' },
  { key: 'author', label: '作者' },
  { key: 'publishedAt', label: '发布时间' },
  { key: 'fetchedAt', label: '抓取时间' },
] as const;

function extractRow(it: Item): Record<string, string> {
  const p = (it.payload ?? {}) as Record<string, unknown>;
  const author =
    typeof p.author === 'object' && p.author !== null
      ? (((p.author as Record<string, unknown>).name as string | undefined) ?? '')
      : String(p.author ?? '');
  return {
    id: String(it.id),
    platform: it.platform ?? '',
    kind: it.kind ? (KIND_LABELS[it.kind] ?? it.kind) : '',
    spider: it.spider ?? '',
    url: it.url ?? '',
    sourceId: it.sourceId ?? '',
    title: (p.title as string | undefined) ?? '',
    description: (p.description as string | undefined) ?? '',
    author,
    publishedAt: (p.publishedAt as string | undefined) ?? '',
    fetchedAt: new Date(it.fetchedAt).toLocaleString(),
  };
}

/** 生成 SpreadsheetML（.xls）——无需第三方库，Excel / WPS 可直接打开 */
function itemsToXls(items: Item[]): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const rawHeader = EXPORT_COLUMNS.map(
    (c) => `<Cell><Data ss:Type="String">${esc(c.label)}</Data></Cell>`,
  ).join('');

  const headerRow =
    '<Row>' +
    rawHeader
      .split('</Cell>')
      .filter(Boolean)
      .map((c) => c.replace('<Cell>', '<Cell ss:StyleID="header">') + '</Cell>')
      .join('') +
    '</Row>';

  const dataRows = items
    .map((it) => {
      const row = extractRow(it);
      const cells = EXPORT_COLUMNS.map(
        (c) => `<Cell><Data ss:Type="String">${esc(row[c.key] ?? '')}</Data></Cell>`,
      ).join('');
      return `<Row>${cells}</Row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#E8F0FE" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="条目列表">
    <Table>
      ${headerRow}
      ${dataRows}
    </Table>
  </Worksheet>
</Workbook>`;
}

function itemsToCsv(items: Item[]): string {
  const escape = (v: string) => {
    return v.includes(',') || v.includes('"') || v.includes('\n')
      ? `"${v.replace(/"/g, '""')}"`
      : v;
  };
  const header = EXPORT_COLUMNS.map((c) => escape(c.label)).join(',');
  const rows = items.map((it) => {
    const row = extractRow(it);
    return EXPORT_COLUMNS.map((c) => escape(row[c.key] ?? '')).join(',');
  });
  return [header, ...rows].join('\n');
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob(['﻿' + content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── 来源 chip ─────────────────────────────────────────────────────────────────

const TRIGGER_KIND_OPTIONS: { value: string; label: string; icon?: LucideIcon }[] = [
  { value: '', label: '全部来源' },
  { value: 'subscription', label: '订阅', icon: RefreshCw },
  { value: 'batch', label: '批量', icon: Layers },
  { value: 'extract', label: '快取', icon: Link2 },
];

// ── 页面主体 ──────────────────────────────────────────────────────────────────

export default function DataPage() {
  const [q, setQ] = useState('');
  const [platform, setPlatform] = useState('');
  const [kind, setKind] = useState('');
  const [triggerKind, setTriggerKind] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const queryClient = useQueryClient();

  // 筛选条件变化时重置到第 1 页
  function setFilter(fn: () => void) {
    fn();
    setPage(1);
    setSelected(new Set());
  }

  function buildParams(overridePage?: number, overridePageSize?: number) {
    const params = new URLSearchParams({
      page: String(overridePage ?? page),
      pageSize: String(overridePageSize ?? PAGE_SIZE),
    });
    if (q) params.set('q', q);
    if (platform) params.set('platform', platform);
    if (kind) params.set('kind', kind);
    if (triggerKind) params.set('triggerKind', triggerKind);
    return params;
  }

  const { data, isLoading } = useQuery({
    queryKey: ['items', q, platform, kind, triggerKind, page],
    queryFn: () => api.get<ListResult<Item>>(`/api/items?${buildParams().toString()}`),
    refetchInterval: 10_000,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;
  const currentIds = data?.data.map((it) => it.id) ?? [];
  const allOnPageSelected = currentIds.length > 0 && currentIds.every((id) => selected.has(id));

  // ── 全选/取消全选当前页 ────────────────────────────────────────────────────
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
    mutationFn: (ids: string[]) => api.delete<{ deleted: number }>('/api/items', { ids }),
    onSuccess: (res) => {
      toast.success(`已删除 ${res.deleted} 条条目`);
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ['items'] });
    },
    onError: (err: Error) => {
      toast.error(`删除失败：${err.message}`);
    },
  });

  function handleDeleteSelected() {
    if (selected.size === 0) return;
    setShowDeleteConfirm(true);
  }

  // ── 导出：拉取当前筛选条件下全部数据 / 仅选中行 ──────────────────────────
  async function handleExport(format: 'csv' | 'json' | 'xls', onlySelected = false) {
    setExporting(true);
    try {
      let items: Item[];
      if (onlySelected && selected.size > 0) {
        // 仅导出选中行（当前页已加载，直接从 data 过滤）
        items = (data?.data ?? []).filter((it) => selected.has(it.id));
      } else {
        const all = await api.get<ListResult<Item>>(
          `/api/items?${buildParams(1, 5000).toString()}`,
        );
        items = all.data;
      }
      const ts = new Date().toISOString().slice(0, 10);
      if (format === 'csv') {
        downloadBlob(itemsToCsv(items), `items-${ts}.csv`, 'text/csv;charset=utf-8;');
      } else if (format === 'xls') {
        downloadBlob(
          itemsToXls(items),
          `items-${ts}.xls`,
          'application/vnd.ms-excel;charset=utf-8;',
        );
      } else {
        downloadBlob(JSON.stringify(items, null, 2), `items-${ts}.json`, 'application/json');
      }
    } finally {
      setExporting(false);
    }
  }

  // platform / kind 选项从当前页数据推断（静态已知平台兜底）
  const knownPlatforms = ['youtube', 'bilibili', 'xhs', 'weibo', 'douyin'];
  const knownKinds = Object.keys(KIND_LABELS);

  return (
    <>
      <div className="space-y-4">
        {/* ── 来源 chip 行 ── */}
        <div className="flex items-center gap-1.5">
          {TRIGGER_KIND_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.value}
                onClick={() => setFilter(() => setTriggerKind(opt.value))}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  triggerKind === opt.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                }`}
              >
                {Icon && <Icon className="h-3 w-3" />}
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* ── 筛选栏 ── */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="搜索 URL 或 title..."
            value={q}
            onChange={(e) => setFilter(() => setQ(e.target.value))}
            className="max-w-xs"
          />

          <select
            value={platform}
            onChange={(e) => setFilter(() => setPlatform(e.target.value))}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">所有平台</option>
            {knownPlatforms.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <select
            value={kind}
            onChange={(e) => setFilter(() => setKind(e.target.value))}
            className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="">所有类型</option>
            {knownKinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k] ?? k}
              </option>
            ))}
          </select>

          <span className="flex-1 text-sm text-muted-foreground">共 {data?.total ?? 0} 条</span>

          {/* 批量操作（有选中时显示） */}
          {selected.size > 0 && (
            <>
              <span className="text-sm font-medium text-muted-foreground">
                已选 {selected.size} 条
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={exporting}
                onClick={() => {
                  void handleExport('xls', true);
                }}
              >
                导出选中 Excel
              </Button>
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

          {/* 全量导出按钮 */}
          <Button
            size="sm"
            variant="outline"
            disabled={exporting || !data?.total}
            onClick={() => {
              void handleExport('xls');
            }}
          >
            {exporting ? '导出中…' : '导出 Excel'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={exporting || !data?.total}
            onClick={() => {
              void handleExport('csv');
            }}
          >
            导出 CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={exporting || !data?.total}
            onClick={() => {
              void handleExport('json');
            }}
          >
            导出 JSON
          </Button>
        </div>

        <Card>
          <CardContent className="p-0">
            {/* 全选条 */}
            {data && data.data.length > 0 && (
              <div className="flex items-center gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={allOnPageSelected}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 cursor-pointer rounded border-gray-300"
                  aria-label="全选当前页"
                />
                <span>全选当前页</span>
              </div>
            )}

            {isLoading && (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">加载中…</div>
            )}
            {data?.data.length === 0 && !isLoading && (
              <div className="px-6 py-12 text-center text-sm text-muted-foreground">
                还没有抓取到任何条目。
              </div>
            )}

            <ul className="divide-y">
              {data?.data.map((it) => (
                <DataRow
                  key={it.id}
                  item={it}
                  selected={selected.has(it.id)}
                  onToggle={() => toggleOne(it.id)}
                />
              ))}
            </ul>
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
        title="删除条目"
        description={`确定删除选中的 ${selected.size} 条条目？此操作不可撤销。`}
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

// ── 单行卡片 ──────────────────────────────────────────────────────────────────

interface DataRowProps {
  item: Item;
  selected: boolean;
  onToggle: () => void;
}

/** 从 payload 里挑封面：优先 thumbnail，其次第一张 image */
function pickCover(item: Item): string | null {
  const p = item.payload as Record<string, unknown> | null;
  if (!p) return null;
  const media = p.media;
  if (!Array.isArray(media)) return null;
  const thumb = media.find(
    (m): m is { kind?: string; url?: string } =>
      typeof m === 'object' && m !== null && (m as { kind?: string }).kind === 'thumbnail',
  );
  if (thumb?.url) return thumb.url;
  const firstImage = media.find(
    (m): m is { kind?: string; url?: string } =>
      typeof m === 'object' && m !== null && typeof (m as { url?: string }).url === 'string',
  );
  return firstImage?.url ?? null;
}

function getAuthorName(item: Item): string | null {
  const p = item.payload as Record<string, unknown> | null;
  const a = p?.author;
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object') {
    return ((a as Record<string, unknown>).name as string | undefined) ?? null;
  }
  return null;
}

function DataRow({ item, selected, onToggle }: DataRowProps) {
  const payload = (item.payload ?? {}) as Record<string, unknown>;
  const title = (payload.title as string | undefined) ?? null;
  const description = (payload.description as string | undefined) ?? null;
  const publishedAt = payload.publishedAt as string | undefined;
  const author = getAuthorName(item);
  const cover = pickCover(item);
  const kindLabel = item.kind ? (KIND_LABELS[item.kind] ?? item.kind) : null;
  const kindColor = item.kind ? (KIND_COLORS[item.kind] ?? '') : '';

  return (
    <li
      className={`flex gap-3 px-4 py-3 transition-colors hover:bg-muted/30 ${
        selected ? 'bg-muted/40' : ''
      }`}
    >
      {/* 复选框 */}
      <div className="flex shrink-0 items-start pt-1">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="h-4 w-4 cursor-pointer rounded border-gray-300"
          aria-label="选择条目"
        />
      </div>

      {/* 封面（16:9，固定宽 160px） */}
      <Link
        href={`/data/${item.id}`}
        className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-md bg-muted"
      >
        {cover ? (
          <img
            src={cover}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              // 图加载失败时折叠 src，让占位图显示
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-6 w-6" />
          </div>
        )}
      </Link>

      {/* 文字区 */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* 标题 + 类型 + 平台 */}
        <div className="flex items-start gap-2">
          <Link href={`/data/${item.id}`} className="min-w-0 flex-1 hover:underline">
            <p className="line-clamp-2 text-sm font-medium leading-snug">{title ?? item.url}</p>
          </Link>
          <div className="flex shrink-0 items-center gap-1.5">
            {kindLabel && (
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${kindColor}`}
              >
                {kindLabel}
              </span>
            )}
            {item.platform && (
              <Badge variant="outline" className="text-xs">
                {item.platform}
              </Badge>
            )}
          </div>
        </div>

        {/* 简介 */}
        {description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{description}</p>
        )}

        {/* 元数据底栏 */}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-0.5 pt-1 text-xs text-muted-foreground">
          {author && <span>{author}</span>}
          {publishedAt && <span>{new Date(publishedAt).toLocaleDateString()}</span>}
          <span className="text-muted-foreground/70">{item.spider}</span>
          <span className="ml-auto">抓取于 {new Date(item.fetchedAt).toLocaleString()}</span>
        </div>
      </div>
    </li>
  );
}
