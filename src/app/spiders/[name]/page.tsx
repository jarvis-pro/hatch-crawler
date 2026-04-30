"use client";
import { use } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Spider } from "@/lib/db";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JsonViewer } from "@/components/items/json-viewer";

export default function SpiderDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = use(params);
  const { data, isLoading } = useQuery({
    queryKey: ["spider", name],
    queryFn: () => api.get<Spider>(`/api/spiders/${name}`),
  });

  if (isLoading) return <div>加载中…</div>;
  if (!data) return <div>未找到 Spider：{name}</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{data.displayName}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <dt className="text-muted-foreground">name</dt>
            <dd className="font-mono">{data.name}</dd>
            <dt className="text-muted-foreground">startUrls</dt>
            <dd>
              <ul>
                {data.startUrls.map((u) => (
                  <li key={u} className="font-mono text-xs">
                    {u}
                  </li>
                ))}
              </ul>
            </dd>
            <dt className="text-muted-foreground">allowedHosts</dt>
            <dd>{data.allowedHosts.join(", ") || "—"}</dd>
            <dt className="text-muted-foreground">maxDepth</dt>
            <dd>{data.maxDepth}</dd>
            <dt className="text-muted-foreground">concurrency</dt>
            <dd>{data.concurrency}</dd>
            <dt className="text-muted-foreground">cronSchedule</dt>
            <dd className="font-mono">{data.cronSchedule ?? "—"}</dd>
            <dt className="text-muted-foreground">enabled</dt>
            <dd>{data.enabled ? "✓" : "—"}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>原始数据</CardTitle>
        </CardHeader>
        <CardContent>
          <JsonViewer data={data} />
        </CardContent>
      </Card>
    </div>
  );
}
