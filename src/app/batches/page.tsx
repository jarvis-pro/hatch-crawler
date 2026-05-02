'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Layers, PlusCircle } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Spider, Run } from '@/lib/db';
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
}

const PLATFORM_BADGE: Record<string, string> = {
  youtube: 'bg-red-100 text-red-800',
  bilibili: 'bg-blue-100 text-blue-800',
  xhs: 'bg-rose-100 text-rose-800',
  weibo: 'bg-orange-100 text-orange-800',
  douyin: 'bg-gray-100 text-gray-800',
};

function LastRunCell({ spiderId }: { spiderId: string }) {
  const { data } = useQuery({
    queryKey: ['lastrun', spiderId],
    queryFn: () => api.get<ListResult<Run>>(`/api/runs?spiderId=${spiderId}&pageSize=1`),
    staleTime: 30_000,
  });
  const run = data?.data[0];
  if (!run) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div className="flex items-center gap-2">
      <RunStatusBadge status={run.status} />
      <span className="text-xs text-muted-foreground">
        {new Date(run.createdAt).toLocaleDateString('zh-CN')}
      </span>
    </div>
  );
}

export default function BatchesPage() {
  const { data: spiders, isLoading } = useQuery({
    queryKey: ['spiders', 'batch'],
    queryFn: () => api.get<Spider[]>('/api/spiders?taskKind=batch'),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">批量</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            一次性大量抓取任务（手动触发，无 cron）
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/dev/spiders">
            <PlusCircle className="mr-2 h-4 w-4" />
            新建
          </Link>
        </Button>
      </div>

      {isLoading && <div className="py-12 text-center text-sm text-muted-foreground">加载中…</div>}

      {!isLoading && (!spiders || spiders.length === 0) && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Layers className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">还没有批量任务</p>
            <p className="text-xs text-muted-foreground">
              在 Dev → Spiders 创建不带 cron 的 spider，它会自动出现在这里
            </p>
          </CardContent>
        </Card>
      )}

      {spiders && spiders.length > 0 && (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>平台</TableHead>
                <TableHead>最近一次运行</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {spiders.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/batches/${s.id}`} className="font-medium hover:underline">
                      {s.name}
                    </Link>
                    {s.description && (
                      <p className="text-xs text-muted-foreground">{s.description}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    {s.platform ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PLATFORM_BADGE[s.platform] ?? 'bg-gray-100 text-gray-700'}`}
                      >
                        {s.platform}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <LastRunCell spiderId={s.id} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/batches/${s.id}`}>详情</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
