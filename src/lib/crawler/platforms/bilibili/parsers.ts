/**
 * Bilibili Web API 响应类型定义及解析工具。
 *
 * 接口文档：非官方，基于逆向观察。
 * 主要使用两个接口：
 *   - /x/space/arc/search     （UP 主投稿列表）
 *   - /x/web-interface/search/type  （关键词搜索）
 */

// ── UP 主投稿接口 ─────────────────────────────────────────────────────────────

export interface BiliVlistItem {
  aid: number;
  bvid: string;
  title: string;
  description: string;
  /** 缩略图，以 "//" 开头，需补 "https:" */
  pic: string;
  /** Unix 时间戳（秒） */
  pubdate: number;
  play: number;
  video_review: number;
  /** "mm:ss" 或 "h:mm:ss" */
  length: string;
  author: string;
  mid: number;
}

export interface BiliSpaceArcResponse {
  code: number;
  message?: string;
  data?: {
    list?: {
      vlist?: BiliVlistItem[];
    };
    page?: {
      pn: number;
      ps: number;
      count: number;
    };
  };
}

// ── 搜索接口 ──────────────────────────────────────────────────────────────────

export interface BiliSearchItem {
  aid: number;
  bvid: string;
  /** title 可能包含 <em class="keyword"> 高亮标签，需剥离 */
  title: string;
  author: string;
  mid: number;
  /** 缩略图，以 "//" 开头 */
  pic: string;
  /** Unix 时间戳（秒） */
  pubdate: number;
  play: number | string;
  video_review: number | string;
  favorites: number | string;
  /** "mm:ss" 或 "h:mm:ss" */
  duration: string;
  description?: string;
}

export interface BiliSearchResponse {
  code: number;
  message?: string;
  data?: {
    result?: BiliSearchItem[];
    numResults?: number;
    numPages?: number;
  };
}

// ── 解析工具 ──────────────────────────────────────────────────────────────────

/**
 * 将 Bilibili 时长字符串（"mm:ss" 或 "h:mm:ss"）转换为毫秒数。
 */
export function parseBiliDurationMs(s: string): number {
  const parts = s.split(':').map(Number);
  if (parts.length === 3) {
    return ((parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0)) * 1000;
  }
  if (parts.length === 2) {
    return ((parts[0] ?? 0) * 60 + (parts[1] ?? 0)) * 1000;
  }
  return 0;
}

/**
 * 补全 Bilibili 缩略图 URL（"//i0.hdslb.com/..." → "https://i0.hdslb.com/..."）。
 */
export function normalizePic(pic: string): string {
  if (pic.startsWith('//')) return `https:${pic}`;
  return pic;
}

/**
 * 剥离 title 中的 <em> 高亮标签（搜索结果接口返回的 HTML 碎片）。
 */
export function stripHighlight(title: string): string {
  return title.replace(/<\/?em[^>]*>/g, '');
}

/**
 * 将 BiliVlistItem 转换为符合 VideoItem kind 的 payload（来自 UP 主投稿接口）。
 */
export function vlistItemToPayload(item: BiliVlistItem): Record<string, unknown> {
  return {
    platform: 'bilibili',
    kind: 'video',
    sourceId: item.bvid,
    url: `https://www.bilibili.com/video/${item.bvid}`,
    title: item.title,
    description: item.description || undefined,
    author: {
      id: String(item.mid),
      name: item.author,
      url: `https://space.bilibili.com/${String(item.mid)}`,
    },
    publishedAt: new Date(item.pubdate * 1000).toISOString(),
    durationMs: parseBiliDurationMs(item.length),
    metrics: {
      views: item.play || undefined,
      comments: item.video_review || undefined,
    },
    media: item.pic
      ? [{ kind: 'thumbnail', url: normalizePic(item.pic), mime: 'image/jpeg' }]
      : undefined,
    raw: item,
  };
}

/**
 * 将 BiliSearchItem 转换为符合 VideoItem kind 的 payload（来自搜索接口）。
 */
export function searchItemToPayload(item: BiliSearchItem): Record<string, unknown> {
  return {
    platform: 'bilibili',
    kind: 'video',
    sourceId: item.bvid,
    url: `https://www.bilibili.com/video/${item.bvid}`,
    title: stripHighlight(item.title),
    description: item.description || undefined,
    author: {
      id: String(item.mid),
      name: item.author,
      url: `https://space.bilibili.com/${String(item.mid)}`,
    },
    publishedAt: new Date(item.pubdate * 1000).toISOString(),
    durationMs: parseBiliDurationMs(item.duration),
    metrics: {
      views: Number(item.play) || undefined,
      comments: Number(item.video_review) || undefined,
      favorites: Number(item.favorites) || undefined,
    },
    media: item.pic
      ? [{ kind: 'thumbnail', url: normalizePic(item.pic), mime: 'image/jpeg' }]
      : undefined,
    raw: item,
  };
}
