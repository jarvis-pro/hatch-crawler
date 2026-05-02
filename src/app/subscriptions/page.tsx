'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, PlusCircle, CheckCircle, Pause } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Spider } from '@/lib/db';
import { platformBadgeClass, cronLabel } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function SubscriptionsPage() {
  const { data: spiders, isLoading } = useQuery({
    queryKey: ['spiders', 'subscription'],
    queryFn: () => api.get<Spider[]>('/api/spiders?taskKind=subscription'),
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">订阅</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">按 cron 自动运行的持续抓取任务</p>
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
            <RefreshCw className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">还没有订阅任务</p>
            <p className="text-xs text-muted-foreground">
              在 Dev → Spiders 创建带 cron 表达式的 spider，它会自动出现在这里
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
                <TableHead>调度</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {spiders.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link href={`/subscriptions/${s.id}`} className="font-medium hover:underline">
                      {s.name}
                    </Link>
                    {s.description && (
                      <p className="text-xs text-muted-foreground">{s.description}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    {s.platform ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${platformBadgeClass(s.platform)}`}
                      >
                        {s.platform}
                      </span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{cronLabel(s.cronSchedule)}</TableCell>
                  <TableCell>
                    {s.enabled ? (
                      <span className="flex items-center gap-1 text-xs text-green-700">
                        <CheckCircle className="h-3.5 w-3.5" />
                        启用
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Pause className="h-3.5 w-3.5" />
                        停用
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/subscriptions/${s.id}`}>详情</Link>
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
