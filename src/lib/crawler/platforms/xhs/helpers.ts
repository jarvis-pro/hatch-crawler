/**
 * 小红书 API URL 构造 + 请求 header 工具。
 *
 * 小红书 Web 接口通过两道保护：
 *   1. Cookie（必须）：包含 web_session 等字段，由用户从浏览器复制并存入 accounts 表。
 *   2. X-s / X-t 签名（可选但推荐）：防机器人签名，算法随 APP 版本变化。
 *      generateSign() 提供一个基础实现；若失效可覆盖或留空（部分接口仅凭 cookie 可访问）。
 */

import { createHash } from 'node:crypto';

const BASE = 'https://edith.xiaohongshu.com';

// ── 基础 Header（模拟桌面浏览器）────────────────────────────────────────────

export const XHS_BASE_HEADERS: Record<string, string> = {
  'user-agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  accept: 'application/json, text/plain, */*',
  'accept-language': 'zh-CN,zh;q=0.9',
  'content-type': 'application/json;charset=UTF-8',
  origin: 'https://www.xiaohongshu.com',
  referer: 'https://www.xiaohongshu.com/',
};

/**
 * 生成 X-s / X-t 签名 header（简化实现）。
 *
 * 注意：小红书官方算法会随版本迭代，此处使用一个经逆向观察整理的简化版本。
 * 如遇 {"code":-301} 等签名校验失败，可：
 *   a) 更新此函数；
 *   b) 从浏览器抓取真实的 X-s/X-t 后手动传入 extraHeaders。
 *
 * 返回值：{ 'X-s': '...', 'X-t': '...' }
 */
export function generateSign(apiPath: string, body: string): Record<string, string> {
  const xT = Math.ceil(Date.now() / 1000).toString();
  // 简化签名：sha256(path + body + xT) 截取 32 位 hex（非官方算法，仅作占位）
  const payload = `${apiPath}${body}${xT}`;
  const xS = createHash('sha256').update(payload).digest('hex').slice(0, 32);
  return { 'X-s': xS, 'X-t': xT };
}

/**
 * 构造携带 Cookie + 签名的完整 headers。
 *
 * @param cookie   从 accounts 表解密出的 cookie 字符串
 * @param apiPath  请求路径（用于签名计算）
 * @param body     请求 body 字符串（GET 时传 ''）
 */
export function buildXhsHeaders(
  cookie: string,
  apiPath: string,
  body: string,
): Record<string, string> {
  return {
    ...XHS_BASE_HEADERS,
    cookie,
    ...generateSign(apiPath, body),
  };
}

// ── URL 构造 ──────────────────────────────────────────────────────────────────

export interface SearchParams {
  keyword: string;
  page?: number;
  pageSize?: number;
  /** 排序：general=综合，time_descending=最新，popularity_descending=最热 */
  sort?: 'general' | 'time_descending' | 'popularity_descending';
  /** 笔记类型：0=不限，1=视频，2=图文 */
  noteType?: 0 | 1 | 2;
}

export function buildSearchBody(params: SearchParams): string {
  return JSON.stringify({
    keyword: params.keyword,
    page: params.page ?? 1,
    page_size: params.pageSize ?? 20,
    search_id: generateSearchId(),
    sort: params.sort ?? 'general',
    note_type: params.noteType ?? 0,
  });
}

export const SEARCH_PATH = '/api/sns/web/v1/search/notes';
export const SEARCH_URL = `${BASE}${SEARCH_PATH}`;

export interface UserNotesParams {
  userId: string;
  cursor?: string;
  pageSize?: number;
}

export function buildUserNotesUrl(params: UserNotesParams): string {
  const u = new URL(`${BASE}/api/sns/web/v1/user/posted`);
  u.searchParams.set('user_id', params.userId);
  u.searchParams.set('cursor', params.cursor ?? '');
  u.searchParams.set('num', String(params.pageSize ?? 18));
  u.searchParams.set('image_formats', 'jpg,webp,avif');
  return u.toString();
}

export const USER_NOTES_PATH = '/api/sns/web/v1/user/posted';

// ── 笔记详情接口 POST /api/sns/web/v1/feed ────────────────────────────────────

export const NOTE_DETAIL_PATH = '/api/sns/web/v1/feed';
export const NOTE_DETAIL_URL = `${BASE}${NOTE_DETAIL_PATH}`;

// ── 评论接口 GET /api/sns/web/v1/comment/page ─────────────────────────────────

export const COMMENT_PATH = '/api/sns/web/v1/comment/page';

export interface CommentPageParams {
  noteId: string;
  cursor?: string;
  pageSize?: number;
}

export function buildCommentUrl(params: CommentPageParams): string {
  const u = new URL(`${BASE}${COMMENT_PATH}`);
  u.searchParams.set('note_id', params.noteId);
  u.searchParams.set('cursor', params.cursor ?? '');
  u.searchParams.set('top_comment_id', '');
  u.searchParams.set('image_formats', 'jpg,webp,avif');
  u.searchParams.set('xsec_token', '');
  u.searchParams.set('xsec_source', 'pc_feed');
  return u.toString();
}

export function buildNoteDetailBody(noteId: string): string {
  return JSON.stringify({
    source_note_id: noteId,
    image_formats: ['jpg', 'webp', 'avif'],
    extra: { need_body_topic: '1' },
  });
}

// ── 工具 ──────────────────────────────────────────────────────────────────────

/** 生成随机 search_id（XHS 接口要求） */
function generateSearchId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** 将"1.2万"等中文数字转为整数 */
export function parseCount(s: string | number | undefined): number | undefined {
  if (s == null) return undefined;
  if (typeof s === 'number') return s;
  const cleaned = String(s).replace(/,/g, '');
  if (cleaned.endsWith('万')) return Math.round(parseFloat(cleaned) * 10_000);
  if (cleaned.endsWith('亿')) return Math.round(parseFloat(cleaned) * 1_0000_0000);
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : undefined;
}
