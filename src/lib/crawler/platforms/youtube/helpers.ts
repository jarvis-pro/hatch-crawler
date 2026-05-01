/**
 * YouTube Data API v3 公共工具函数。
 */

const BASE = 'https://www.googleapis.com/youtube/v3';

/** 构造 search.list 请求 URL */
export function buildSearchUrl(opts: {
  apiKey: string;
  /** 按频道过滤 */
  channelId?: string;
  /** 关键词搜索 */
  q?: string;
  maxResults?: number;
  order?: 'date' | 'relevance' | 'viewCount' | 'rating' | 'title';
  pageToken?: string;
}): string {
  const u = new URL(`${BASE}/search`);
  u.searchParams.set('part', 'snippet');
  u.searchParams.set('type', 'video');
  u.searchParams.set('maxResults', String(opts.maxResults ?? 50));
  u.searchParams.set('order', opts.order ?? 'date');
  u.searchParams.set('key', opts.apiKey);
  if (opts.channelId) u.searchParams.set('channelId', opts.channelId);
  if (opts.q) u.searchParams.set('q', opts.q);
  if (opts.pageToken) u.searchParams.set('pageToken', opts.pageToken);
  return u.toString();
}

/** 构造 videos.list 请求 URL（批量获取视频详情） */
export function buildVideosUrl(opts: { apiKey: string; ids: string[] }): string {
  const u = new URL(`${BASE}/videos`);
  u.searchParams.set('part', 'snippet,contentDetails,statistics');
  u.searchParams.set('id', opts.ids.join(','));
  u.searchParams.set('key', opts.apiKey);
  return u.toString();
}

/** 从当前 URL 中提取 pageToken（下一页重用） */
export function extractPageToken(url: string): string | null {
  try {
    return new URL(url).searchParams.get('pageToken');
  } catch {
    return null;
  }
}
