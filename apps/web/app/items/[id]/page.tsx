"use client";
import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Item } from "@hatch-crawler/db";
import { api } from "@/lib/api-client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JsonViewer } from "@/components/items/json-viewer";

export default function ItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const { data, isLoading } = useQuery({
    queryKey: ["item", id],
    queryFn: () => api.get<Item>(`/api/items/${id}`),
  });

  if (isLoading) return <div>加载中…</div>;
  if (!data) return <div>未找到</div>;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>{data.url}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[120px_1fr] gap-2 text-sm">
            <dt className="text-muted-foreground">spider</dt>
            <dd>{data.spider}</dd>
            <dt className="text-muted-foreground">type</dt>
            <dd>{data.type}</dd>
            <dt className="text-muted-foreground">runId</dt>
            <dd className="font-mono text-xs">
              {data.runId ? (
                <Link href={`/runs/${data.runId}`} className="hover:underline">
                  {data.runId}
                </Link>
              ) : (
                "—"
              )}
            </dd>
            <dt className="text-muted-foreground">fetchedAt</dt>
            <dd>{new Date(data.fetchedAt).toLocaleString()}</dd>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Payload</CardTitle>
        </CardHeader>
        <CardContent>
          <JsonViewer data={data.payload} />
        </CardContent>
      </Card>
    </div>
  );
}
