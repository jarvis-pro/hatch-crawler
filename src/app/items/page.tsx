'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Item } from '@/lib/db';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
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

interface ListResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

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

  const header = EXPORT_COLUMNS.map(
    (c) => `<Cell><Data ss:Type="String">${esc(c.label)}</Data></Cell>`,
  ).join('');

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
      <Row>${header
        .split('</Cell>')
        .filter(Boolean)
        .map((c) => c.replace('<Cell>', '<Cell ss:StyleID="header">') + '</Cell>')
        .join('')}</Row>
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

// ── 页面主体 ──────────────────────────────────────────────────────────────────

export default function ItemsPage() {
  const [q, setQ] = useState('');
  const [platform, setPlatform] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  // 筛选条件变化时重置到第 1 页
  function setFilter(fn: () => void) {
    fn();
    setPage(1);
  }

  function buildParams(overridePage?: number, overridePageSize?: number) {
    const params = new URLSearchParams({
      page: String(overridePage ?? page),
      pageSize: String(overridePageSize ?? PAGE_SIZE),
    });
    if (q) params.set('q', q);
    if (platform) params.set('platform', platform);
    if (kind) params.set('kind', kind);
    return params;
  }

  const { data, isLoading } = useQuery({
    queryKey: ['items', q, platform, kind, page],
    queryFn: () => api.get<ListResult<Item>>(`/api/items?${buildParams().toString()}`),
    refetchInterval: 10_000,
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  // ── 导出：拉取当前筛选条件下全部数据 ──────────────────────────────────────
  async function handleExport(format: 'csv' | 'json' | 'xls') {
    setExporting(true);
    try {
      const all = await api.get<ListResult<Item>>(`/api/items?${buildParams(1, 5000).toString()}`);
      const ts = new Date().toISOString().slice(0, 10);
      if (format === 'csv') {
        downloadBlob(itemsToCsv(all.data), `items-${ts}.csv`, 'text/csv;charset=utf-8;');
      } else if (format === 'xls') {
        downloadBlob(
          itemsToXls(all.data),
          `items-${ts}.xls`,
          'application/vnd.ms-excel;charset=utf-8;',
        );
      } else {
        downloadBlob(JSON.stringify(all.data, null, 2), `items-${ts}.json`, 'application/json');
      }
    } finally {
      setExporting(false);
    }
  }

  // platform / kind 选项从当前页数据推断（静态已知平台兜底）
  const knownPlatforms = ['youtube', 'bilibili', 'xhs', 'nextjs-blog'];
  const knownKinds = Object.keys(KIND_LABELS);

  return (
    <div className="space-y-4">
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

        {/* 导出按钮 */}
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>平台 / Spider</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>Title / URL</TableHead>
                <TableHead>抓取时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              )}
              {data?.data.length === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    还没有抓取到任何条目。
                  </TableCell>
                </TableRow>
              )}
              {data?.data.map((it) => {
                const title = (it.payload as { title?: string } | null)?.title ?? null;
                const kindLabel = it.kind ? (KIND_LABELS[it.kind] ?? it.kind) : null;
                const kindColor = it.kind ? (KIND_COLORS[it.kind] ?? '') : '';
                return (
                  <TableRow key={it.id}>
                    <TableCell className="font-mono text-xs">{it.id}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {it.platform && (
                          <span className="text-xs font-medium text-muted-foreground">
                            {it.platform}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">{it.spider}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {kindLabel ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${kindColor}`}
                        >
                          {kindLabel}
                        </span>
                      ) : (
                        <Badge variant="outline">{it.type}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-sm">
                      <Link
                        href={`/items/${String(it.id)}`}
                        className="line-clamp-1 hover:underline"
                      >
                        {title ?? it.url}
                      </Link>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(it.fetchedAt).toLocaleString()}
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
