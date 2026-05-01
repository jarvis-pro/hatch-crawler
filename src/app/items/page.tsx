'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Item } from '@/lib/db';
import { api } from '@/lib/api-client';
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

export default function ItemsPage() {
  const [q, setQ] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['items', q],
    queryFn: () =>
      api.get<ListResult<Item>>(`/api/items?pageSize=50${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    refetchInterval: 10_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="搜索 URL 或 title..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-md"
        />
        <span className="self-center text-sm text-muted-foreground">{data?.total ?? 0} 条</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Spider</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Title / URL</TableHead>
                <TableHead>Fetched</TableHead>
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
                return (
                  <TableRow key={it.id}>
                    <TableCell className="font-mono text-xs">{it.id}</TableCell>
                    <TableCell>{it.spider}</TableCell>
                    <TableCell>{it.type}</TableCell>
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
