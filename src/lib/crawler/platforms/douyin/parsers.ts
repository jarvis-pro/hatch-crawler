/**
 * 抖音 API 响应类型定义及解析工具。
 */

// ── 通用视频结构 ──────────────────────────────────────────────────────────────

export interface DouyinAuthor {
  uid: string;
  nickname: string;
  avatar_thumb?: { url_list?: string[] };
  sec_uid?: string;
}

export interface DouyinStatistics {
  admire_count?: number;
  collect_count?: number;
  comment_count?: number;
  digg_count?: number;
  play_count?: number;
  share_count?: number;
}

export interface DouyinVideo {
  play_addr?: { url_list?: string[] };
  cover?: { url_list?: string[] };
  duration?: number;
}

export interface DouyinAweme {
  aweme_id: string;
  desc: string;
  author?: DouyinAuthor;
  statistics?: DouyinStatistics;
  video?: DouyinVideo;
  create_time?: number;
  share_url?: string;
}

// ── 搜索接口响应 ──────────────────────────────────────────────────────────────

export interface DouyinSearchItem {
  aweme_info?: DouyinAweme;
}

export interface DouyinSearchResponse {
  status_code: number;
  data?: DouyinSearchItem[];
  has_more?: number;
  cursor?: number;
}

// ── 用户视频列表接口响应 ──────────────────────────────────────────────────────

export interface DouyinUserVideosResponse {
  status_code: number;
  aweme_list?: DouyinAweme[];
  has_more?: number;
  max_cursor?: number;
}

// ── 解析工具 ──────────────────────────────────────────────────────────────────

function firstUrl(list?: string[]): string | undefined {
  return list?.[0];
}

/**
 * 将 DouyinAweme 转换为标准 payload。
 */
export function awemeToPayload(aweme: DouyinAweme): Record<string, unknown> {
  const coverUrl = firstUrl(aweme.video?.cover?.url_list);
  const authorAvatar = firstUrl(aweme.author?.avatar_thumb?.url_list);

  return {
    platform: 'douyin',
    kind: 'video',
    sourceId: aweme.aweme_id,
    url: aweme.share_url ?? `https://www.douyin.com/video/${aweme.aweme_id}`,
    title: aweme.desc || undefined,
    description: aweme.desc || undefined,
    author: aweme.author
      ? {
          id: aweme.author.uid,
          name: aweme.author.nickname,
          avatar: authorAvatar,
          url: `https://www.douyin.com/user/${aweme.author.sec_uid ?? aweme.author.uid}`,
        }
      : undefined,
    publishedAt: aweme.create_time ? new Date(aweme.create_time * 1000).toISOString() : undefined,
    durationMs: aweme.video?.duration ?? undefined,
    metrics: {
      plays: aweme.statistics?.play_count,
      likes: aweme.statistics?.digg_count,
      comments: aweme.statistics?.comment_count,
      shares: aweme.statistics?.share_count,
      collects: aweme.statistics?.collect_count,
    },
    media: coverUrl ? [{ kind: 'thumbnail', url: coverUrl, mime: 'image/jpeg' }] : undefined,
    raw: aweme,
  };
}
