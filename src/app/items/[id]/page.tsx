'use client';
import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { Item } from '@/lib/db';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function fmtNum(n: unknown): string {
  if (n == null) return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
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

// ── VideoQuickDownload ────────────────────────────────────────────────────────

/**
 * 视频详情右上角的一键下载按钮组。
 * 点击后直接触发浏览器下载，通过流式代理接口从源头抓取。
 */
function VideoQuickDownload({ item }: { item: Item }) {
  // 检查 yt-dlp 是否可用（设置 + 系统 health）
  const { data: ytSetting } = useQuery({
    queryKey: ['setting', 'enable_youtube_download'],
    queryFn: () =>
      api.get<{ key: string; value: unknown }>('/api/settings/enable_youtube_download'),
  });
  const { data: health } = useQuery({
    queryKey: ['system', 'health'],
    queryFn: () => api.get<{ ytdlp: { ok: boolean } }>('/api/system/health'),
  });
  const ytdlpAvailable = Boolean(ytSetting?.value) && Boolean(health?.ytdlp?.ok);

  if (!ytdlpAvailable) return null;

  const downloadUrl = (fetcher: 'ytdlp') =>
    `/api/items/${String(item.id)}/download?url=${encodeURIComponent(item.url)}&fetcher=${fetcher}`;

  return (
    <div className="flex shrink-0 gap-1.5">
      <a href={downloadUrl('ytdlp')} download>
        <Button size="sm" variant="outline">
          ↓ 视频
        </Button>
      </a>
      <a href={`${downloadUrl('ytdlp')}&audioOnly=1`} download>
        <Button size="sm" variant="outline">
          ↓ 音频
        </Button>
      </a>
    </div>
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

  return (
    <div className="space-y-4">
      {/* 缩略图 + 标题 */}
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

      {/* 核心指标 */}
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

      {/* 简介 */}
      {p.description && (
        <p className="line-clamp-4 text-sm leading-relaxed text-muted-foreground">
          {p.description}
        </p>
      )}

      {/* 标签 */}
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

// ── PostDetail（XHS 图文 / 普通帖）─────────────────────────────────────────────

interface MediaItem {
  kind?: string;
  url?: string;
  width?: number;
  height?: number;
}

interface PostPayload {
  title?: string;
  description?: string;
  publishedAt?: string;
  updatedAt?: string;
  tags?: string[];
  author?: { id?: string; name?: string; avatar?: string; url?: string };
  metrics?: { likes?: number; comments?: number; collects?: number; shares?: number };
  media?: MediaItem[];
  noteId?: string;
}

function PostDetail({ item }: { item: Item }) {
  const p = item.payload as PostPayload;
  const images = (p.media ?? []).filter((m) => m.kind === 'image' || m.kind === 'cover');
  const videoMedia = (p.media ?? []).find((m) => m.kind === 'video');

  return (
    <div className="space-y-4">
      {/* 标题 + 作者 */}
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

      {/* 视频链接（笔记详情）*/}
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

      {/* 图片网格 */}
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

      {/* 正文 */}
      {p.description && (
        <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          {p.description}
        </p>
      )}

      {/* 互动数据 */}
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

      {/* 标签 */}
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

// ── CommentDetail（XHS 评论）──────────────────────────────────────────────────

interface SubComment {
  commentId?: string;
  content?: string;
  author?: { name?: string; url?: string };
  publishedAt?: string;
  ipLocation?: string;
  metrics?: { likes?: number };
}

interface CommentPayload {
  commentId?: string;
  noteId?: string;
  content?: string;
  author?: { id?: string; name?: string; avatar?: string; url?: string };
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
      {/* 主评论 */}
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

      {/* 回复数 */}
      {p.metrics?.replies != null && p.metrics.replies > 0 && (
        <p className="text-xs text-muted-foreground">
          共 {p.metrics.replies} 条回复{subs.length > 0 ? `，已展示 ${subs.length} 条` : ''}
        </p>
      )}

      {/* 二级评论 */}
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

export default function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
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
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-sm font-normal text-muted-foreground">
              #{data.id} · {data.spider}
            </CardTitle>
            <div className="flex shrink-0 gap-1">
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
          <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm">
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
            <dt className="text-muted-foreground">runId</dt>
            <dd>
              {data.runId ? (
                <Link href={`/runs/${data.runId}`} className="font-mono text-xs hover:underline">
                  {data.runId}
                </Link>
              ) : (
                '—'
              )}
            </dd>
            <dt className="text-muted-foreground">抓取时间</dt>
            <dd className="text-xs">{fmtDate(data.fetchedAt)}</dd>
          </dl>
        </CardContent>
      </Card>

      {/* 富展示 / 通用 JSON */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{richTitle}</CardTitle>
            {isVideo && <VideoQuickDownload item={data} />}
          </div>
        </CardHeader>
        <CardContent>
          {isVideo && <VideoDetail item={data} />}
          {isPost && <PostDetail item={data} />}
          {isComment && <CommentDetail item={data} />}
          {!hasRichView && <JsonViewer data={data.payload} />}
        </CardContent>
      </Card>

      {/* 富展示时保留原始 JSON（可折叠查看） */}
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
