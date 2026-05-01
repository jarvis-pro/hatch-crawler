/**
 * 微博 API 响应类型定义及解析工具。
 *
 * 数据源：m.weibo.cn/api/container/getIndex（移动版容器接口）
 */

// ── 通用容器响应 ──────────────────────────────────────────────────────────────

export interface WeiboUser {
  id: number;
  screen_name: string;
  profile_image_url?: string;
  verified?: boolean;
  followers_count?: number;
}

export interface WeiboPostPic {
  url?: string;
  large?: { url?: string };
}

export interface WeiboPost {
  id: string;
  mid?: string;
  text: string;
  /** 原始 HTML，需剥离标签 */
  raw_text?: string;
  created_at: string;
  user?: WeiboUser;
  reposts_count?: number;
  comments_count?: number;
  attitudes_count?: number;
  pics?: WeiboPostPic[];
  page_info?: {
    type?: string;
    page_title?: string;
    content2?: string;
    page_pic?: { url?: string };
    page_url?: string;
  };
  retweeted_status?: WeiboPost;
}

export interface WeiboCardMBlog {
  mblog?: WeiboPost;
}

export interface WeiboCard {
  card_type: number;
  mblog?: WeiboPost;
  card_group?: WeiboCard[];
}

export interface WeiboContainerData {
  cards?: WeiboCard[];
  cardlistInfo?: {
    page?: number;
    total?: number;
  };
}

export interface WeiboContainerResponse {
  ok: number;
  data?: WeiboContainerData;
}

// ── 解析工具 ──────────────────────────────────────────────────────────────────

/**
 * 剥离微博 text 中的 HTML 标签，保留纯文字。
 */
export function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim();
}

/**
 * 将微博日期字符串（如 "Mon May 01 12:00:00 +0800 2026"）转为 ISO 格式。
 * 无法解析时返回原字符串。
 */
export function parseWeiboDate(s: string): string {
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch {
    // ignore
  }
  return s;
}

/**
 * 从 WeiboPost 中提取媒体图片列表。
 */
export function extractPics(post: WeiboPost): Array<{ kind: string; url: string }> {
  return (post.pics ?? [])
    .map((p) => p.large?.url ?? p.url)
    .filter((u): u is string => Boolean(u))
    .map((url) => ({ kind: 'image', url }));
}

/**
 * 将 WeiboPost 转换为标准 payload。
 */
export function postToPayload(post: WeiboPost): Record<string, unknown> {
  const text = post.raw_text ? stripHtml(post.raw_text) : stripHtml(post.text);
  const pics = extractPics(post);

  return {
    platform: 'weibo',
    kind: 'post',
    sourceId: post.id,
    url: `https://weibo.com/${post.user?.id ?? ''}/${post.id}`,
    title: text.slice(0, 100) || undefined,
    description: text || undefined,
    author: post.user
      ? {
          id: String(post.user.id),
          name: post.user.screen_name,
          avatar: post.user.profile_image_url,
          url: `https://weibo.com/u/${post.user.id}`,
        }
      : undefined,
    publishedAt: parseWeiboDate(post.created_at),
    metrics: {
      reposts: post.reposts_count,
      comments: post.comments_count,
      likes: post.attitudes_count,
    },
    media: pics.length > 0 ? pics : undefined,
    retweetedId: post.retweeted_status?.id,
    raw: post,
  };
}

/**
 * 从容器卡片列表中提取 WeiboPost 列表（过滤 card_type=9 的微博卡片）。
 */
export function extractPostsFromCards(cards: WeiboCard[]): WeiboPost[] {
  const posts: WeiboPost[] = [];
  for (const card of cards) {
    if (card.card_type === 9 && card.mblog) {
      posts.push(card.mblog);
    } else if (Array.isArray(card.card_group)) {
      for (const sub of card.card_group) {
        if (sub.card_type === 9 && sub.mblog) {
          posts.push(sub.mblog);
        }
      }
    }
  }
  return posts;
}
