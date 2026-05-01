'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Item } from '@/lib/db';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
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

const KIND_LABELS: Record<string, string> = {
  article: '文章',
  video: '视频',
  audio: '音频',
  image: '图片',
  post: '短帖',
};

const KIND_COLORS: Record<string, string> = {
  article: 'bg-blue-100 text-blue-800',
  video: 'bg-purple-100 text-purple-800',
  audio: 'bg-green-100 text-green-800',
  image: 'bg-yellow-100 text-yellow-800',
  post: 'bg-orange-100 text-orange-800',
};

export default function ItemsPage() {
  const [q, setQ] = useState('');
  const [platform, setPlatform] = useState('');
  const [kind, setKind] = useState('');

  const buildQuery = () => {
    const params = new URLSearchParams({ pageSize: '50' });
    if (q) params.set('q', q);
    if (platform) params.set('platform', platform);
    if (kind) params.set('kind', kind);
    return `/api/items?${params.toString()}`;
  };

  const { data, isLoading } = useQuery({
    queryKey: ['items', q, platform, kind],
    queryFn: () => api.get<ListResult<Item>>(buildQuery()),
    refetchInterval: 10_000,
  });

  // 从已有数据归纳出 platform / kind 选项（辅助筛选下拉）
  const platforms = Array.from(new Set(data?.data.map((i) => i.platform).filter(Boolean))).sort();
  const kinds = Array.from(new Set(data?.data.map((i) => i.kind).filter(Boolean))).sort();

  return (
    <div className="space-y-4">
      {/* ── 筛选栏 ── */}
      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="搜索 URL 或 title..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />

        {/* Platform 筛选 */}
        <select
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">所有平台</option>
          {platforms.map((p) => (
            <option key={p} value={p ?? ''}>
              {p}
            </option>
          ))}
        </select>

        {/* Kind 筛选 */}
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
        >
          <option value="">所有类型</option>
          {kinds.map((k) => (
            <option key={k} value={k ?? ''}>
              {k ? (KIND_LABELS[k] ?? k) : k}
            </option>
          ))}
        </select>

        <span className="self-center text-sm text-muted-foreground">{data?.total ?? 0} 条</span>
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
                    <TableCell>
                      <Link href={`/items/${String(it.id)}`} className="hover:underline">
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
    </div>
  );
}
