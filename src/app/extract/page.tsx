'use client';
import { useState, useRef, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle, XCircle, Loader2, Link2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Item } from '@/lib/db';

interface ExtractResponse {
  runId: string;
  accepted: number;
  rejected: string[];
}

interface ListResult<T> {
  data: T[];
  total: number;
}

type RowState = 'pending' | 'done' | 'error';

interface ResultRow {
  url: string;
  state: RowState;
  item?: Item;
}

// 推断行的简短标题
function rowTitle(row: ResultRow): string {
  if (row.state === 'pending') return '抓取中…';
  if (row.state === 'error') return '失败';
  const p = row.item?.payload as Record<string, unknown> | undefined;
  return (p?.title as string | undefined) ?? row.item?.url ?? row.url;
}

function rowThumbnail(row: ResultRow): string | null {
  const p = row.item?.payload as Record<string, unknown> | undefined;
  const media = p?.media as { kind?: string; url?: string }[] | undefined;
  return media?.find((m) => m.kind === 'thumbnail')?.url ?? null;
}

export default function ExtractPage() {
  const qc = useQueryClient();
  const [rawText, setRawText] = useState('');
  const [runId, setRunId] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [rows, setRows] = useState<ResultRow[]>([]);
  const esRef = useRef<EventSource | null>(null);

  // 提交 URL 列表
  const submit = useMutation({
    mutationFn: (urls: string[]) => api.post<ExtractResponse>('/api/extract', { urls }),
    onSuccess: (res) => {
      setRunId(res.runId);
      setDone(false);
      // 初始化 rows（把 accepted 的 URL 解析不出来，从 rejected 里去掉即可）
      // 其实服务端只返回了 accepted 数量而非列表，所以这里用原始文本行
      const parsed = rawText
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !res.rejected.includes(s));
      setRows(parsed.map((url) => ({ url, state: 'pending' })));
    },
    onError: (err) => {
      toast.error(`提交失败：${String(err)}`);
    },
  });

  // 订阅 SSE 查看进度，run 完成后拉取结果 items
  const { data: itemsResult, refetch: refetchItems } = useQuery({
    queryKey: ['extract-items', runId],
    queryFn: () => api.get<ListResult<Item>>(`/api/items?runId=${runId ?? ''}&pageSize=100`),
    enabled: done && !!runId,
  });

  // SSE 连接
  useEffect(() => {
    if (!runId) return;
    if (esRef.current) esRef.current.close();
    const es = new EventSource(`/sse/runs/${runId}/logs`);
    esRef.current = es;

    es.addEventListener('done', () => {
      setDone(true);
      void refetchItems();
      void qc.invalidateQueries({ queryKey: ['extract-items', runId] });
      es.close();
    });

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [runId, refetchItems, qc]);

  // 当 items 回来后，把 rows 更新为 done/error 状态
  useEffect(() => {
    if (!itemsResult) return;
    const fetchedItems = itemsResult.data;
    setRows((prev) =>
      prev.map((row) => {
        const match = fetchedItems.find(
          (it) => it.url === row.url || (it.payload as Record<string, unknown>)?.url === row.url,
        );
        if (match) return { ...row, state: 'done', item: match };
        // 如果已 done 还没结果，标 error
        if (done) return { ...row, state: 'error' };
        return row;
      }),
    );
  }, [itemsResult, done]);

  const handleSubmit = () => {
    const urls = rawText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (urls.length === 0) {
      toast.error('请输入至少一条 URL');
      return;
    }
    if (urls.length > 50) {
      toast.error('单次最多 50 条 URL');
      return;
    }
    submit.mutate(urls);
  };

  const handleClear = () => {
    if (esRef.current) esRef.current.close();
    setRunId(null);
    setDone(false);
    setRows([]);
    setRawText('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">快取</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          粘贴视频 / 内容链接（每行一条，最多 50 条），立即抓取详情
        </p>
      </div>

      {/* 输入区 */}
      <Card>
        <CardContent className="pt-4">
          <textarea
            className="w-full rounded-md border bg-background p-3 font-mono text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            rows={6}
            placeholder={
              'https://www.youtube.com/watch?v=...\nhttps://www.bilibili.com/video/BV...\nhttps://www.xiaohongshu.com/explore/...'
            }
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            disabled={submit.isPending}
          />
          <div className="mt-3 flex items-center gap-2">
            <Button
              onClick={handleSubmit}
              disabled={submit.isPending || rawText.trim().length === 0}
            >
              {submit.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  提交中…
                </>
              ) : (
                <>
                  <Link2 className="mr-2 h-4 w-4" />
                  开始抓取
                </>
              )}
            </Button>
            {rows.length > 0 && (
              <Button variant="outline" size="sm" onClick={handleClear}>
                清空结果
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* 结果表 */}
      {rows.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              结果
              {!done && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              {done && (
                <span className="text-sm font-normal text-muted-foreground">
                  完成 · {rows.filter((r) => r.state === 'done').length}/{rows.length} 成功
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {rows.map((row, i) => {
                const thumb = rowThumbnail(row);
                return (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    {/* 状态图标 */}
                    <div className="shrink-0">
                      {row.state === 'pending' && (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      )}
                      {row.state === 'done' && <CheckCircle className="h-4 w-4 text-green-600" />}
                      {row.state === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
                    </div>

                    {/* 缩略图（仅有时才显示） */}
                    {thumb && (
                      <img src={thumb} alt="" className="h-10 w-16 shrink-0 rounded object-cover" />
                    )}

                    {/* 标题 + URL */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium leading-snug">{rowTitle(row)}</p>
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noreferrer"
                        className="truncate text-xs text-muted-foreground hover:underline"
                      >
                        {row.url}
                      </a>
                    </div>

                    {/* 详情链接 */}
                    {row.item && (
                      <a
                        href={`/data/${String(row.item.id)}`}
                        className="shrink-0 text-xs text-muted-foreground hover:underline"
                      >
                        详情 →
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
