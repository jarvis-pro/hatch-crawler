/**
 * YouTube Data API v3 响应类型定义及解析工具。
 */

// ── API 响应类型 ──────────────────────────────────────────────────────────────

export interface YTThumbnail {
  url: string;
  width?: number;
  height?: number;
}

export interface YTSnippet {
  publishedAt?: string;
  channelId?: string;
  channelTitle?: string;
  title: string;
  description?: string;
  thumbnails?: {
    default?: YTThumbnail;
    medium?: YTThumbnail;
    high?: YTThumbnail;
    maxres?: YTThumbnail;
  };
  tags?: string[];
  categoryId?: string;
  liveBroadcastContent?: string;
}

export interface YTContentDetails {
  /** ISO 8601 duration，如 "PT4M13S" */
  duration?: string;
  dimension?: string;
  definition?: string;
  caption?: string;
}

export interface YTStatistics {
  viewCount?: string;
  likeCount?: string;
  commentCount?: string;
}

export interface YTSearchItem {
  kind: string;
  id: { kind: string; videoId?: string; channelId?: string; playlistId?: string };
  snippet: YTSnippet;
}

export interface YTVideoItem {
  kind: string;
  id: string;
  snippet: YTSnippet;
  contentDetails?: YTContentDetails;
  statistics?: YTStatistics;
}

export interface YTSearchResponse {
  kind: string;
  nextPageToken?: string;
  prevPageToken?: string;
  regionCode?: string;
  pageInfo?: { totalResults?: number; resultsPerPage?: number };
  items: YTSearchItem[];
  error?: { code: number; message: string };
}

export interface YTVideosResponse {
  kind: string;
  nextPageToken?: string;
  pageInfo?: { totalResults?: number; resultsPerPage?: number };
  items: YTVideoItem[];
  error?: { code: number; message: string };
}

// ── 解析工具 ──────────────────────────────────────────────────────────────────

/**
 * 将 ISO 8601 duration（如 "PT4M13S"）转换为毫秒数。
 */
export function parseDurationMs(iso: string): number {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const s = Number(m[3] ?? 0);
  return (h * 3600 + min * 60 + s) * 1000;
}

/**
 * 从 YTVideoItem 解析出最佳缩略图 URL。
 */
export function bestThumbnail(item: YTVideoItem | YTSearchItem): string | undefined {
  const t = 'snippet' in item ? item.snippet.thumbnails : undefined;
  if (!t) return undefined;
  return (t.maxres ?? t.high ?? t.medium ?? t.default)?.url;
}

/**
 * 将 YTVideoItem 转换为符合 VideoItem kind 的 payload。
 */
export function videoItemToPayload(item: YTVideoItem): Record<string, unknown> {
  const thumb = bestThumbnail(item);
  return {
    platform: 'youtube',
    kind: 'video',
    sourceId: item.id,
    url: `https://www.youtube.com/watch?v=${item.id}`,
    title: item.snippet.title,
    description: item.snippet.description ?? undefined,
    author: item.snippet.channelId
      ? {
          id: item.snippet.channelId,
          name: item.snippet.channelTitle ?? '',
          url: `https://www.youtube.com/channel/${item.snippet.channelId}`,
        }
      : undefined,
    publishedAt: item.snippet.publishedAt ?? undefined,
    tags: item.snippet.tags ?? undefined,
    durationMs: item.contentDetails?.duration
      ? parseDurationMs(item.contentDetails.duration)
      : undefined,
    metrics: {
      views: item.statistics?.viewCount ? Number(item.statistics.viewCount) : undefined,
      likes: item.statistics?.likeCount ? Number(item.statistics.likeCount) : undefined,
      comments: item.statistics?.commentCount ? Number(item.statistics.commentCount) : undefined,
    },
    media: thumb ? [{ kind: 'thumbnail', url: thumb, mime: 'image/jpeg' }] : undefined,
    raw: {
      snippet: item.snippet,
      contentDetails: item.contentDetails,
      statistics: item.statistics,
    },
  };
}
