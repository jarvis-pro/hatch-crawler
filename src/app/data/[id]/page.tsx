'use client';
import { use, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import type { Item } from '@/lib/db';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { JsonViewer } from '@/components/items/json-viewer';

// ── 样式映射 ──────────────────────────────────────────────────────────────────

const PLATFORM_BADGE: Record<string, string> = {
  youtube: 'bg-red-100 text-red-800',
  bilibili: 'bg-blue-100 text-blue-800',
  xhs: 'bg-rose-100 text-rose-800',
};

const KIND_BADGE: Record<string, string> = {
  video: 'bg-purple-100 text-purple-800',
  article: 'bg-blue-100 text-blue-800',
  audio: 'bg-green-100 text-green-800',
  image: 'bg-yellow-100 text-yellow-800',
  post: 'bg-orange-100 text-orange-800',
  comment: 'bg-pink-100 text-pink-800',
};

const TRIGGER_KIND_LABEL: Record<string, string> = {
  subscription: '📅 订阅',
  batch: '📦 批量',
  extract: '🔗 快取',
};

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function fmtNum(n: unknown): string {
  if (n == null) return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  if (num >= 1_0000_0000) {
    const v = (num / 1_0000_0000).toFixed(1);
    return `${v.endsWith('.0') ? v.slice(0, -2) : v}亿`;
  }
  if (num >= 1_0000) {
    const v = (num / 1_0000).toFixed(1);
    return `${v.endsWith('.0') ? v.slice(0, -2) : v}万`;
  }
  return num.toLocaleString('zh-CN');
}

function fmtDuration(ms: unknown): string {
  if (ms == null) return '—';
  const total = Math.floor(Number(ms) / 1000);
  if (!Number.isFinite(total) || total <= 0) return '—';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${String(h)}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m)}:${String(s).padStart(2, '0')}`;
}

function fmtDate(iso: unknown): string {
  if (!iso) return '—';
  try {
    return new Date(String(iso)).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

// ── 来源链接 ──────────────────────────────────────────────────────────────────

function SourceLink({ item }: { item: Item }) {
  const triggerKind = item.triggerKind;
  const taskId = item.taskId;
  const kindLabel = triggerKind ? (TRIGGER_KIND_LABEL[triggerKind] ?? triggerKind) : null;

  if (!triggerKind || !taskId) return <span className="text-xs text-muted-foreground">—</span>;

  if (triggerKind === 'subscription') {
    return (
      <Link href={`/subscriptions/${taskId}`} className="text-xs hover:underline">
        {kindLabel} · {item.spider ?? taskId}
      </Link>
    );
  }
  if (triggerKind === 'batch') {
    return (
      <Link href={`/batches/${taskId}`} className="text-xs hover:underline">
        {kindLabel} · {item.spider ?? taskId}
      </Link>
    );
  }
  // extract — no drill-down page
  return (
    <span className="text-xs text-muted-foreground">
      {kindLabel} · {item.spider ?? taskId}
    </span>
  );
}

// ── VideoDownloadMenu ─────────────────────────────────────────────────────────

interface StoredVideoFormatEntry {
  height: number;
  size?: number;
}

interface StoredVideoFormats {
  formats?: StoredVideoFormatEntry[];
  heights?: number[];
  hasAudio: boolean;
  audioSize?: number;
}

function fmtBytes(bytes: number | undefined): string | null {
  if (bytes == null || bytes <= 0) return null;
  if (bytes >= 1024 ** 3) return `~${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `~${Math.round(bytes / 1024 ** 2)} MB`;
  return `~${Math.round(bytes / 1024)} KB`;
}

const FALLBACK_HEIGHTS = [1080, 720, 480, 360];

function VideoDownloadMenu({ item }: { item: Item }) {
  const qc = useQueryClient();

  const { data: ytSetting } = useQuery({
    queryKey: ['setting', 'enable_youtube_download'],
    queryFn: () =>
      api.get<{ key: string; value: unknown }>('/api/settings/enable_youtube_download'),
  });
  const { data: health } = useQuery({
    queryKey: ['system', 'health'],
    queryFn: () => api.get<{ ytdlp: { ok: boolean } }>('/api/system/health'),
  });
  const isLoading = ytSetting === undefined || health === undefined;
  const ytdlpAvailable = Boolean(ytSetting?.value) && Boolean(health?.ytdlp?.ok);

  const fetchFormats = useMutation({
    mutationFn: () => api.post<StoredVideoFormats>(`/api/items/${String(item.id)}/formats`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['item', String(item.id)] });
      toast.success('格式信息已更新');
    },
    onError: (err) => toast.error(`获取格式失败：${String(err)}`),
  });

  if (isLoading || !ytdlpAvailable) {
    return (
      <Button
        variant="default"
        size="sm"
        className="pointer-events-none shrink-0 gap-1.5 opacity-0"
        disabled
      >
        下载
        <ChevronDown className="h-3.5 w-3.5" />
      </Button>
    );
  }

  const base = `/api/items/${String(item.id)}/download?url=${encodeURIComponent(item.url)}&fetcher=ytdlp`;

  const storedFormats = (item.payload as Record<string, unknown>)?.videoFormats as
    | StoredVideoFormats
    | undefined;

  const storedEntries: StoredVideoFormatEntry[] =
    storedFormats?.formats ?? (storedFormats?.heights ?? []).map((h) => ({ height: h }));

  const hasStoredFormats = storedEntries.length > 0;
  const videoEntries: StoredVideoFormatEntry[] = hasStoredFormats
    ? storedEntries
    : FALLBACK_HEIGHTS.map((h) => ({ height: h }));
  const showAudio: boolean = hasStoredFormats ? storedFormats!.hasAudio : true;
  const isFallback = !hasStoredFormats;

  function heightToQuality(h: number): string {
    if (h >= 2160) return 'best';
    if (h >= 1080) return '1080p';
    if (h >= 720) return '720p';
    if (h >= 480) return '480p';
    return '360p';
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="default" size="sm" className="shrink-0 gap-1.5">
          下载
          <ChevronDown className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="flex items-center justify-between pr-1">
          <span>
            视频下载
            {isFallback ? <span className="ml-1 font-normal opacity-60">预设</span> : null}
          </span>
          {isFallback && (
            <button
              onClick={(e) => {
                e.preventDefault();
                fetchFormats.mutate();
              }}
              disabled={fetchFormats.isPending}
              title="调用 yt-dlp 获取该视频的实际可用分辨率"
              className="rounded p-0.5 opacity-60 hover:opacity-100 disabled:opacity-30"
            >
              <RefreshCw className={`h-3 w-3 ${fetchFormats.isPending ? 'animate-spin' : ''}`} />
            </button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuGroup>
          {videoEntries.map(({ height: h, size }) => {
            const q = heightToQuality(h);
            const label = h >= 2160 ? '4K' : `${String(h)}p`;
            return (
              <DropdownMenuItem key={h} asChild>
                <a
                  href={`${base}&quality=${q}`}
                  download
                  className="flex w-full items-center justify-between gap-3"
                >
                  <span>↓ {label} 视频</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fmtBytes(size) ?? '—'}
                  </span>
                </a>
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>

        {showAudio && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <a
                  href={`${base}&audioOnly=true`}
                  download
                  className="flex w-full items-center justify-between gap-3"
                >
                  <span>↓ 音频（MP3）</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {fmtBytes(storedFormats?.audioSize) ?? '—'}
                  </span>
                </a>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ── VideoDetail ───────────────────────────────────────────────────────────────

interface VideoPayload {
  title?: string;
  description?: string;
  publishedAt?: string;
  durationMs?: number;
  tags?: string[];
  author?: { id?: string; name?: string; url?: string };
  metrics?: { views?: number; likes?: number; comments?: number; favorites?: number };
  media?: { kind?: string; url?: string }[];
}

function VideoDetail({ item }: { item: Item }) {
  const p = item.payload as VideoPayload;
  const thumbnail = p.media?.find((m) => m.kind === 'thumbnail')?.url;
  const [descExpanded, setDescExpanded] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        {thumbnail && (
          <a href={item.url} target="_blank" rel="noreferrer" className="shrink-0">
            <img
              src={thumbnail}
              alt={p.title ?? ''}
              className="h-32 w-56 rounded-lg object-cover shadow-sm"
            />
          </a>
        )}
        <div className="min-w-0 space-y-1">
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="text-base font-semibold leading-snug hover:underline"
          >
            {p.title ?? item.url}
          </a>
          {p.author?.name && (
            <p className="text-sm text-muted-foreground">
              {p.author.url ? (
                <a href={p.author.url} target="_blank" rel="noreferrer" className="hover:underline">
                  {p.author.name}
                </a>
              ) : (
                p.author.name
              )}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{fmtDate(p.publishedAt)}</p>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '播放量', value: fmtNum(p.metrics?.views) },
          { label: '点赞', value: fmtNum(p.metrics?.likes) },
          { label: '评论', value: fmtNum(p.metrics?.comments) },
          { label: '时长', value: fmtDuration(p.durationMs) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border bg-muted/40 px-3 py-2 text-center">
            <p className="text-lg font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {p.description && (
        <div>
          <p
            className={`whitespace-pre-line text-sm leading-relaxed text-muted-foreground ${descExpanded ? '' : 'line-clamp-6'}`}
          >
            {p.description}
          </p>
          <button
            onClick={() => setDescExpanded((v) => !v)}
            className="mt-1 text-xs text-muted-foreground/70 hover:text-muted-foreground"
          >
            {descExpanded ? '收起' : '展开'}
          </button>
        </div>
      )}

      {(p.tags ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {p.tags!.map((tag) => (
            <Badge key={tag} variant="outline" className="text-xs">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ── PostDetail ────────────────────────────────────────────────────────────────

interface MediaItem {
  kind?: string;
  url?: string;
}

interface PostPayload {
  title?: string;
  description?: string;
  publishedAt?: string;
  tags?: string[];
  author?: { id?: string; name?: string; avatar?: string; url?: string };
  metrics?: { likes?: number; comments?: number; collects?: number; shares?: number };
  media?: MediaItem[];
}

function PostDetail({ item }: { item: Item }) {
  const p = item.payload as PostPayload;
  const images = (p.media ?? []).filter((m) => m.kind === 'image' || m.kind === 'cover');
  const videoMedia = (p.media ?? []).find((m) => m.kind === 'video');

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="text-base font-semibold leading-snug hover:underline"
        >
          {p.title || '（无标题）'}
        </a>
        {p.author?.name && (
          <p className="text-sm text-muted-foreground">
            {p.author.url ? (
              <a href={p.author.url} target="_blank" rel="noreferrer" className="hover:underline">
                {p.author.name}
              </a>
            ) : (
              p.author.name
            )}
            {p.publishedAt && <span className="ml-2">{fmtDate(p.publishedAt)}</span>}
          </p>
        )}
      </div>

      {videoMedia?.url && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <span className="text-muted-foreground">视频：</span>
          <a
            href={videoMedia.url}
            target="_blank"
            rel="noreferrer"
            className="break-all text-xs hover:underline"
          >
            {videoMedia.url}
          </a>
        </div>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((img, i) => (
            <a key={i} href={img.url} target="_blank" rel="noreferrer">
              <img
                src={img.url}
                alt={`图片 ${i + 1}`}
                className="aspect-square w-full rounded-md object-cover shadow-sm"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      )}

      {p.description && (
        <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          {p.description}
        </p>
      )}

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '点赞', value: fmtNum(p.metrics?.likes) },
          { label: '评论', value: fmtNum(p.metrics?.comments) },
          { label: '收藏', value: fmtNum(p.metrics?.collects) },
          { label: '分享', value: fmtNum(p.metrics?.shares) },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-lg border bg-muted/40 px-3 py-2 text-center">
            <p className="text-lg font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>

      {(p.tags ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(p.tags ?? []).map((tag) => (
            <Badge key={String(tag)} variant="outline" className="text-xs">
              #{String(tag)}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ── CommentDetail ─────────────────────────────────────────────────────────────

interface SubComment {
  commentId?: string;
  content?: string;
  author?: { name?: string; url?: string };
  publishedAt?: string;
  ipLocation?: string;
  metrics?: { likes?: number };
}

interface CommentPayload {
  content?: string;
  author?: { id?: string; name?: string; url?: string };
  publishedAt?: string;
  ipLocation?: string;
  metrics?: { likes?: number; replies?: number };
  subComments?: SubComment[];
}

function CommentDetail({ item }: { item: Item }) {
  const p = item.payload as CommentPayload;
  const subs = p.subComments ?? [];

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4">
        <div className="mb-2 flex items-center gap-2 text-sm">
          {p.author?.url ? (
            <a
              href={p.author.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:underline"
            >
              {p.author.name ?? '用户'}
            </a>
          ) : (
            <span className="font-medium">{p.author?.name ?? '用户'}</span>
          )}
          {p.publishedAt && (
            <span className="text-xs text-muted-foreground">{fmtDate(p.publishedAt)}</span>
          )}
          {p.ipLocation && (
            <span className="text-xs text-muted-foreground">IP: {p.ipLocation}</span>
          )}
          {p.metrics?.likes != null && (
            <span className="ml-auto text-xs text-muted-foreground">
              ♥ {fmtNum(p.metrics.likes)}
            </span>
          )}
        </div>
        <p className="whitespace-pre-line text-sm leading-relaxed">{p.content}</p>
      </div>

      {p.metrics?.replies != null && p.metrics.replies > 0 && (
        <p className="text-xs text-muted-foreground">
          共 {p.metrics.replies} 条回复{subs.length > 0 ? `，已展示 ${subs.length} 条` : ''}
        </p>
      )}

      {subs.length > 0 && (
        <div className="ml-4 space-y-2 border-l-2 border-muted pl-4">
          {subs.map((sc, i) => (
            <div key={sc.commentId ?? i} className="rounded-md bg-muted/40 p-3 text-sm">
              <div className="mb-1 flex items-center gap-2">
                {sc.author?.url ? (
                  <a
                    href={sc.author.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium hover:underline"
                  >
                    {sc.author.name ?? '用户'}
                  </a>
                ) : (
                  <span className="text-xs font-medium">{sc.author?.name ?? '用户'}</span>
                )}
                {sc.publishedAt && (
                  <span className="text-xs text-muted-foreground">{fmtDate(sc.publishedAt)}</span>
                )}
                {sc.metrics?.likes != null && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    ♥ {fmtNum(sc.metrics.likes)}
                  </span>
                )}
              </div>
              <p className="whitespace-pre-line text-xs leading-relaxed">{sc.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 页面主体 ──────────────────────────────────────────────────────────────────

export default function DataItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data, isLoading } = useQuery({
    queryKey: ['item', id],
    queryFn: () => api.get<Item>(`/api/items/${id}`),
  });

  if (isLoading)
    return <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>;
  if (!data)
    return <div className="py-8 text-center text-sm text-muted-foreground">未找到条目 #{id}</div>;

  const isVideo = data.kind === 'video';
  const isPost = data.kind === 'post';
  const isComment = data.kind === 'comment';
  const hasRichView = isVideo || isPost || isComment;

  const richTitle = isVideo ? '视频详情' : isPost ? '帖子详情' : isComment ? '评论详情' : 'Payload';

  return (
    <div className="space-y-4">
      {/* 元数据卡 */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">
              #{data.id} · {data.spider}
            </CardTitle>
            <div className="flex shrink-0 items-center gap-1">
              {data.platform && (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PLATFORM_BADGE[data.platform] ?? 'bg-gray-100 text-gray-700'}`}
                >
                  {data.platform}
                </span>
              )}
              {data.kind && (
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${KIND_BADGE[data.kind] ?? 'bg-gray-100 text-gray-700'}`}
                >
                  {data.kind}
                </span>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4">
            <dl className="grid flex-1 grid-cols-[110px_1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">URL</dt>
              <dd>
                <a
                  href={data.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-xs hover:underline"
                >
                  {data.url}
                </a>
              </dd>
              {data.sourceId && (
                <>
                  <dt className="text-muted-foreground">sourceId</dt>
                  <dd className="font-mono text-xs">{data.sourceId}</dd>
                </>
              )}
              <dt className="text-muted-foreground">来源任务</dt>
              <dd>
                <SourceLink item={data} />
              </dd>
              <dt className="text-muted-foreground">运行记录</dt>
              <dd>
                {data.runId ? (
                  <Link
                    href={`/dev/runs/${data.runId}`}
                    className="font-mono text-xs hover:underline"
                  >
                    {data.runId}
                  </Link>
                ) : (
                  '—'
                )}
              </dd>
              <dt className="text-muted-foreground">抓取时间</dt>
              <dd className="text-xs">{fmtDate(data.fetchedAt)}</dd>
            </dl>
            {isVideo && <VideoDownloadMenu item={data} />}
          </div>
        </CardContent>
      </Card>

      {/* 富展示 / 通用 JSON */}
      <Card>
        <CardHeader>
          <CardTitle>{richTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          {isVideo && <VideoDetail item={data} />}
          {isPost && <PostDetail item={data} />}
          {isComment && <CommentDetail item={data} />}
          {!hasRichView && <JsonViewer data={data.payload} />}
        </CardContent>
      </Card>

      {hasRichView && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-muted-foreground">原始 Payload</CardTitle>
          </CardHeader>
          <CardContent>
            <JsonViewer data={data.payload} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
