'use client';
import { use } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Run } from '@/lib/db';
import { api, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RunStatusBadge } from '@/components/runs/run-status-badge';
import { LiveLogStream } from '@/components/runs/live-log-stream';
import { StatsCard } from '@/components/stats/stats-card';

export default function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();

  const { data: run } = useQuery({
    queryKey: ['run', id],
    queryFn: () => api.get<Run>(`/api/runs/${id}`),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      // 终止状态不再轮询
      return status === 'running' || status === 'queued' ? 2_000 : false;
    },
  });

  const stop = useMutation({
    mutationFn: () => api.post(`/api/runs/${id}/stop`),
    onSuccess: () => {
      toast.success('已发送停止信号');
      void qc.invalidateQueries({ queryKey: ['run', id] });
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : String(err);
      toast.error(msg);
    },
  });

  if (!run) return <div>加载中…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <RunStatusBadge status={run.status} />
        <span className="font-mono text-sm">{run.id}</span>
        <span className="text-sm text-muted-foreground">·</span>
        <span className="text-sm">{run.spiderName}</span>
        <div className="ml-auto flex gap-2">
          {run.status === 'running' && (
            <Button
              variant="destructive"
              size="sm"
              disabled={stop.isPending}
              onClick={() => stop.mutate()}
            >
              停止
            </Button>
          )}
          {(run.status === 'completed' || run.status === 'failed' || run.status === 'stopped') && (
            <Button asChild size="sm" variant="outline">
              <Link href={`/items?runId=${run.id}`}>查看抓取结果 →</Link>
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatsCard label="Fetched" value={run.fetched} />
        <StatsCard label="Emitted" value={run.emitted} />
        <StatsCard label="New" value={run.newItems} />
        <StatsCard label="Errors" value={run.errors} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>实时日志</CardTitle>
        </CardHeader>
        <CardContent>
          <LiveLogStream
            runId={id}
            onDone={() => {
              void qc.invalidateQueries({ queryKey: ['run', id] });
            }}
          />
        </CardContent>
      </Card>

      {run.errorMessage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600">错误</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap font-mono text-xs">{run.errorMessage}</pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
