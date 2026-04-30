"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Run } from "@hatch-crawler/db";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatsCard } from "@/components/stats/stats-card";
import { RunStatusBadge } from "@/components/runs/run-status-badge";
import { NewRunDialog } from "@/components/runs/new-run-dialog";

interface Summary {
  running: number;
  queued: number;
  completed24h: number;
  failed24h: number;
  totalItems: number;
  newItems24h: number;
}

interface ListResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export default function DashboardPage() {
  const { data: summary } = useQuery({
    queryKey: ["stats", "summary"],
    queryFn: () => api.get<Summary>("/api/stats/summary"),
    refetchInterval: 5_000,
  });

  const { data: active } = useQuery({
    queryKey: ["runs", "active"],
    queryFn: () =>
      api.get<ListResult<Run>>("/api/runs?status=running,queued&pageSize=10"),
    refetchInterval: 5_000,
  });

  const { data: recent } = useQuery({
    queryKey: ["runs", "recent"],
    queryFn: () =>
      api.get<ListResult<Run>>(
        "/api/runs?status=completed,failed,stopped&pageSize=10",
      ),
    refetchInterval: 10_000,
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatsCard label="运行中" value={summary?.running ?? "—"} />
        <StatsCard label="排队" value={summary?.queued ?? "—"} />
        <StatsCard
          label="今日完成"
          value={summary?.completed24h ?? "—"}
          hint="过去 24h"
        />
        <StatsCard
          label="今日失败"
          value={summary?.failed24h ?? "—"}
          hint="过去 24h"
        />
        <StatsCard label="总条目" value={summary?.totalItems ?? "—"} />
        <StatsCard
          label="新增条目"
          value={summary?.newItems24h ?? "—"}
          hint="过去 24h"
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>当前运行</CardTitle>
          <NewRunDialog trigger={<Button size="sm">+ 新建运行</Button>} />
        </CardHeader>
        <CardContent>
          {active?.data.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              暂无运行中或排队的任务
            </div>
          ) : (
            <ul className="divide-y">
              {active?.data.map((r) => (
                <li key={r.id} className="flex items-center gap-4 py-3">
                  <RunStatusBadge status={r.status} />
                  <Link
                    href={`/runs/${r.id}`}
                    className="flex-1 truncate font-mono text-sm hover:underline"
                  >
                    {r.spiderName} · {r.id.slice(0, 8)}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    fetched {r.fetched} · errors {r.errors}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>最近完成</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {recent?.data.map((r) => (
              <li key={r.id} className="flex items-center gap-4 py-3">
                <RunStatusBadge status={r.status} />
                <Link
                  href={`/runs/${r.id}`}
                  className="flex-1 truncate font-mono text-sm hover:underline"
                >
                  {r.spiderName} · {r.id.slice(0, 8)}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {r.fetched} fetched · {r.newItems} new · {r.errors} err
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
