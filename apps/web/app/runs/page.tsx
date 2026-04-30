"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { Run } from "@hatch-crawler/db";
import { api } from "@/lib/api-client";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RunStatusBadge } from "@/components/runs/run-status-badge";

interface ListResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export default function RunsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["runs", "all"],
    queryFn: () => api.get<ListResult<Run>>("/api/runs?pageSize=50"),
    refetchInterval: 5_000,
  });

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Spider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>fetched/emit/new/err</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  加载中…
                </TableCell>
              </TableRow>
            )}
            {data?.data.length === 0 && !isLoading && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  暂无运行记录。点右上角 + 新建运行 试试。
                </TableCell>
              </TableRow>
            )}
            {data?.data.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-mono text-xs">
                  <Link href={`/runs/${r.id}`} className="hover:underline">
                    {r.id.slice(0, 8)}
                  </Link>
                </TableCell>
                <TableCell>{r.spiderName}</TableCell>
                <TableCell>
                  <RunStatusBadge status={r.status} />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {r.fetched}/{r.emitted}/{r.newItems}/{r.errors}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
