'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Attachment } from '@/lib/db';
import type { AttachmentEvent } from '@/lib/shared';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

const KIND_OPTIONS = ['video', 'audio', 'image', 'archive', 'document', 'other'] as const;

const STATUS_BADGE: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-700',
  downloading: 'bg-blue-100 text-blue-800',
  transcoding: 'bg-purple-100 text-purple-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-700',
};

function fmtBytes(n: number | null): string {
  if (n == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(v >= 100 || u === 0 ? 0 : 1)} ${units[u]}`;
}

function fmtSpeed(bps: number | undefined): string {
  if (bps == null) return '';
  return `${fmtBytes(bps)}/s`;
}

interface ProgressInfo {
  pct: number;
  bytes: number;
  totalBytes?: number;
  speedBps?: number;
}

/** 单条 attachment 行：状态/进度/操作。在下载中时通过 SSE 实时更新进度。 */
function AttachmentRow({
  attachment,
  onChanged,
}: {
  attachment: Attachment;
  onChanged: () => void;
}) {
  const [livePct, setLivePct] = useState<ProgressInfo | null>(null);

  // 仅在 downloading / queued 状态下订阅
  const isLive = attachment.status === 'downloading' || attachment.status === 'queued';

  useEffect(() => {
    if (!isLive) return;
    const es = new EventSource(`/sse/attachments/${attachment.id}/progress`);
    const onProgress = (ev: MessageEvent<string>) => {
      const event = JSON.parse(ev.data) as AttachmentEvent;
      if (event.type === 'attach_progress') {
        setLivePct({
          pct: event.pct,
          bytes: event.bytes,
          totalBytes: event.totalBytes,
          speedBps: event.speedBps,
        });
      }
    };
    const onDone = () => {
      es.close();
      // 让父组件重新拉一次列表，拿到最终 storagePath / status / byteSize
      onChanged();
    };
    es.addEventListener('progress', onProgress);
    es.addEventListener('done', onDone);
    return () => {
      es.close();
    };
  }, [attachment.id, isLive, onChanged]);

  const deleteMutation = useMutation({
    mutationFn: () => api.delete<{ deleted: boolean }>(`/api/attachments/${attachment.id}`),
    onSuccess: () => {
      toast.success('已删除附件');
      onChanged();
    },
    onError: (err) => toast.error(`删除失败：${String(err)}`),
  });

  const transcodeMutation = useMutation({
    mutationFn: () =>
      api.post<Attachment>(`/api/attachments/${attachment.id}/transcode`, { op: 'video_to_mp3' }),
    onSuccess: () => {
      toast.success('已入队转码');
      onChanged();
    },
    onError: (err) => toast.error(`转码入队失败：${String(err)}`),
  });

  const onDelete = () => {
    if (window.confirm('确定删除该附件（含磁盘文件）？')) deleteMutation.mutate();
  };

  const pct = livePct?.pct ?? attachment.progressPct ?? 0;
  const showBar =
    attachment.status === 'downloading' ||
    attachment.status === 'queued' ||
    attachment.status === 'transcoding';

  // 「转 mp3」按钮：仅对已完成的视频附件、且本身不是转码产物时显示
  const canTranscode =
    attachment.kind === 'video' && attachment.status === 'completed' && !attachment.transcodeOp;

  // 派生（转码产物）行视觉缩进
  const isDerived = attachment.parentId !== null;

  return (
    <li
      className={`space-y-1 rounded-md border bg-muted/30 px-3 py-2 text-sm ${isDerived ? 'ml-6 border-l-2 border-purple-300' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="flex items-center gap-2">
            {isDerived && <span className="text-xs text-purple-600">↳</span>}
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[attachment.status] ?? 'bg-gray-100 text-gray-700'}`}
            >
              {attachment.status}
            </span>
            <span className="rounded bg-background px-1.5 py-0.5 text-xs">{attachment.kind}</span>
            <span className="rounded bg-background px-1.5 py-0.5 text-xs text-muted-foreground">
              {attachment.fetcherKind}
            </span>
            {attachment.transcodeOp && (
              <span className="rounded bg-background px-1.5 py-0.5 text-xs text-purple-700">
                {attachment.transcodeOp}
              </span>
            )}
            <span className="text-xs text-muted-foreground">{fmtBytes(attachment.byteSize)}</span>
          </p>
          <p className="break-all text-xs text-muted-foreground" title={attachment.sourceUrl}>
            {attachment.sourceUrl}
          </p>
          {attachment.errorMessage && (
            <p className="text-xs text-red-600">⚠ {attachment.errorMessage}</p>
          )}
        </div>
        <div className="shrink-0 space-x-1">
          {canTranscode && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => transcodeMutation.mutate()}
              disabled={transcodeMutation.isPending}
              title="用 ffmpeg 把视频转成 mp3"
            >
              {transcodeMutation.isPending ? '入队中…' : '转 mp3'}
            </Button>
          )}
          {attachment.status === 'completed' && (
            <Button asChild size="sm" variant="outline">
              <a href={`/api/attachments/${attachment.id}/download`}>下载文件</a>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            disabled={deleteMutation.isPending}
            className="text-red-600 hover:text-red-700"
          >
            删除
          </Button>
        </div>
      </div>
      {showBar && (
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-background">
            <div
              className="h-full bg-blue-500 transition-all"
              style={{ width: `${String(pct)}%` }}
            />
          </div>
          <p className="mt-0.5 flex justify-between text-xs tabular-nums text-muted-foreground">
            <span>{pct}%</span>
            {livePct && (
              <span>
                {fmtBytes(livePct.bytes)}
                {livePct.totalBytes ? ` / ${fmtBytes(livePct.totalBytes)}` : ''}
                {livePct.speedBps ? `  ·  ${fmtSpeed(livePct.speedBps)}` : ''}
              </span>
            )}
          </p>
        </div>
      )}
    </li>
  );
}

/** 「下载新附件」对话框：让用户输入 URL + kind + fetcher（http / yt-dlp）*/
function NewDownloadDialog({ itemId, onCreated }: { itemId: number; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<(typeof KIND_OPTIONS)[number]>('video');
  const [fetcherKind, setFetcherKind] = useState<'http' | 'yt-dlp'>('http');

  // 仅在打开对话框时拉 health + setting，避免每次详情页都查
  const { data: health } = useQuery({
    queryKey: ['system', 'health'],
    queryFn: () => api.get<{ ytdlp: { ok: boolean } }>('/api/system/health'),
    enabled: open,
  });
  const { data: ytSetting } = useQuery({
    queryKey: ['setting', 'enable_youtube_download'],
    queryFn: () =>
      api.get<{ key: string; value: unknown }>('/api/settings/enable_youtube_download'),
    enabled: open,
  });

  const ytdlpAvailable = Boolean(ytSetting?.value) && Boolean(health?.ytdlp?.ok);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<Attachment>(`/api/items/${itemId}/attachments`, {
        url,
        kind,
        fetcherKind,
      }),
    onSuccess: () => {
      toast.success('已入队');
      setOpen(false);
      setUrl('');
      setFetcherKind('http');
      onCreated();
    },
    onError: (err) => toast.error(`入队失败：${String(err)}`),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">+ 下载附件</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>下载新附件</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm">下载方式</label>
            <select
              value={fetcherKind}
              onChange={(e) => setFetcherKind(e.target.value as typeof fetcherKind)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              <option value="http">直链 HTTP（mp4 / mp3 / zip ...）</option>
              {ytdlpAvailable && <option value="yt-dlp">yt-dlp（YouTube 等）</option>}
            </select>
            {!ytdlpAvailable && (
              <p className="mt-1 text-xs text-muted-foreground">
                想下载 YouTube？请先在「设置 → 下载」启用 yt-dlp。
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm">URL</label>
            <Input
              placeholder={
                fetcherKind === 'yt-dlp'
                  ? 'https://www.youtube.com/watch?v=...'
                  : 'https://example.com/file.mp4'
              }
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm">类型</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!url || mutation.isPending}>
            {mutation.isPending ? '提交中…' : '入队下载'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AttachmentsPanel({ itemId }: { itemId: number }) {
  const queryClient = useQueryClient();

  const { data: attachments, isLoading } = useQuery({
    queryKey: ['item', itemId, 'attachments'],
    queryFn: () => api.get<Attachment[]>(`/api/items/${itemId}/attachments`),
    // 在有进行中的下载时定期 refetch 拿最终态（SSE done 也会触发 invalidate，二者互补）
    refetchInterval: (q) => {
      const list = q.state.data;
      if (!list) return false;
      const live = list.some((a) => a.status === 'downloading' || a.status === 'queued');
      return live ? 5_000 : false;
    },
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['item', itemId, 'attachments'] });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {isLoading ? '加载中…' : `共 ${attachments?.length ?? 0} 个附件`}
        </p>
        <NewDownloadDialog itemId={itemId} onCreated={refresh} />
      </div>
      {attachments && attachments.length > 0 ? (
        <ul className="space-y-2">
          {attachments.map((a) => (
            <AttachmentRow key={a.id} attachment={a} onChanged={refresh} />
          ))}
        </ul>
      ) : (
        !isLoading && (
          <p className="rounded-md border bg-muted/30 px-3 py-6 text-center text-sm text-muted-foreground">
            还没有附件，点上方按钮添加直链下载
          </p>
        )
      )}
    </div>
  );
}
