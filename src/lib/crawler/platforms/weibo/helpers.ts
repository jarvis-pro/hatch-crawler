/**
 * 微博 API URL 构造工具。
 *
 * 使用微博移动端 / m.weibo.cn API，无需复杂签名，仅需 Cookie。
 */

const BASE_M = 'https://m.weibo.cn';
const BASE_WEB = 'https://weibo.com';

/**
 * 反爬基础 headers。
 */
export const WEIBO_HEADERS: Record<string, string> = {
  Referer: BASE_WEB + '/',
  Origin: BASE_WEB,
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
};

/**
 * 关键词搜索 URL（容器 ID 固定为搜索类型）。
 * GET https://m.weibo.cn/api/container/getIndex?containerid=100103type%3D1%26q%3D<keyword>&page=<n>
 */
export function buildSearchUrl(opts: { query: string; page: number }): string {
  const containerId = `100103type=1&q=${encodeURIComponent(opts.query)}&t=0`;
  const u = new URL(`${BASE_M}/api/container/getIndex`);
  u.searchParams.set('containerid', containerId);
  u.searchParams.set('page_type', 'searchall');
  u.searchParams.set('page', String(opts.page));
  return u.toString();
}

/**
 * 用户微博列表 URL。
 * GET https://m.weibo.cn/api/container/getIndex?uid=<uid>&containerid=107603<uid>&page=<n>
 */
export function buildUserPostsUrl(opts: { uid: string; page: number }): string {
  const containerId = `107603${opts.uid}`;
  const u = new URL(`${BASE_M}/api/container/getIndex`);
  u.searchParams.set('uid', opts.uid);
  u.searchParams.set('containerid', containerId);
  u.searchParams.set('page', String(opts.page));
  return u.toString();
}
