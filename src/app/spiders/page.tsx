'use client';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Spider } from '@/lib/db';
import { api, ApiClientError } from '@/lib/api-client';
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

export default function SpidersPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['spiders'],
    queryFn: () => api.get<Spider[]>('/api/spiders'),
  });

  const runNow = useMutation({
    mutationFn: (spider: string) =>
      api.post<{ id: string }>('/api/runs', { spider, overrides: {} }),
    onSuccess: ({ id }) => {
      toast.success(`Run ${id.slice(0, 8)} 已入队`);
      void qc.invalidateQueries({ queryKey: ['runs'] });
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : String(err);
      toast.error(`启动失败：${msg}`);
    },
  });

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Display</TableHead>
              <TableHead>Cron</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead className="text-right">Actions</TableHead>
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
            {data?.map((s) => (
              <TableRow key={s.name}>
                <TableCell className="font-mono">
                  <Link href={`/spiders/${s.name}`} className="hover:underline">
                    {s.name}
                  </Link>
                </TableCell>
                <TableCell>{s.displayName}</TableCell>
                <TableCell className="font-mono text-xs">{s.cronSchedule ?? '—'}</TableCell>
                <TableCell>{s.enabled ? '✓' : '—'}</TableCell>
                <TableCell className="text-right">
                  <Button
                    size="sm"
                    disabled={!s.enabled || runNow.isPending}
                    onClick={() => runNow.mutate(s.name)}
                  >
                    立即运行
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
