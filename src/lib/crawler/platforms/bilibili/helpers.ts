/**
 * Bilibili API URL 构造工具。
 */

const BASE = 'https://api.bilibili.com';

/**
 * 反爬基础 headers。
 * Bilibili 接口对 Referer 检查较严，缺失时可能返回 -403。
 */
export const BILI_HEADERS: Record<string, string> = {
  Referer: 'https://www.bilibili.com',
  Origin: 'https://www.bilibili.com',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

/** 构造 UP 主投稿列表 URL（/x/space/arc/search） */
export function buildUserVideosUrl(opts: {
  uid: string;
  page: number;
  pageSize?: number;
  order?: 'pubdate' | 'click' | 'stow';
}): string {
  const u = new URL(`${BASE}/x/space/arc/search`);
  u.searchParams.set('mid', opts.uid);
  u.searchParams.set('pn', String(opts.page));
  u.searchParams.set('ps', String(opts.pageSize ?? 30));
  u.searchParams.set('order', opts.order ?? 'pubdate');
  u.searchParams.set('jsonp', 'jsonp');
  return u.toString();
}

/** 构造关键词搜索 URL（/x/web-interface/search/type） */
export function buildSearchUrl(opts: {
  query: string;
  page: number;
  pageSize?: number;
  order?: 'totalrank' | 'click' | 'pubdate' | 'dm' | 'stow';
}): string {
  const u = new URL(`${BASE}/x/web-interface/search/type`);
  u.searchParams.set('search_type', 'video');
  u.searchParams.set('keyword', opts.query);
  u.searchParams.set('page', String(opts.page));
  u.searchParams.set('pagesize', String(opts.pageSize ?? 30));
  u.searchParams.set('order', opts.order ?? 'totalrank');
  return u.toString();
}
