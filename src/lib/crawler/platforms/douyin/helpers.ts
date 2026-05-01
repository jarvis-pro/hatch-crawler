/**
 * 抖音 API URL 构造工具。
 *
 * 使用抖音 Web 端 API（https://www.douyin.com/aweme/...）。
 * 部分参数（msToken、X-Bogus）需要 JS 逆向生成，此处使用已知固定值占位；
 * 实际部署时可通过 cookie 所附带的 Token 自动补全。
 */

const BASE = 'https://www.douyin.com';

/**
 * 反爬基础 headers。
 * 抖音对 User-Agent 和 Referer 检查较严，需与移动端浏览器保持一致。
 */
export const DOUYIN_HEADERS: Record<string, string> = {
  Referer: BASE + '/',
  Origin: BASE,
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

/**
 * 关键词搜索 URL。
 * GET https://www.douyin.com/aweme/v1/web/search/item/?keyword=<kw>&offset=<n>&count=<c>
 */
export function buildSearchUrl(opts: { keyword: string; offset: number; count?: number }): string {
  const u = new URL(`${BASE}/aweme/v1/web/search/item/`);
  u.searchParams.set('keyword', opts.keyword);
  u.searchParams.set('search_channel', 'aweme_video_web');
  u.searchParams.set('enable_history', '1');
  u.searchParams.set('search_source', 'normal_search');
  u.searchParams.set('offset', String(opts.offset));
  u.searchParams.set('count', String(opts.count ?? 10));
  return u.toString();
}

/**
 * 用户主页视频列表 URL。
 * GET https://www.douyin.com/aweme/v1/web/aweme/post/?sec_user_id=<id>&max_cursor=<cursor>&count=<c>
 */
export function buildUserVideosUrl(opts: {
  secUid: string;
  maxCursor?: number;
  count?: number;
}): string {
  const u = new URL(`${BASE}/aweme/v1/web/aweme/post/`);
  u.searchParams.set('sec_user_id', opts.secUid);
  u.searchParams.set('max_cursor', String(opts.maxCursor ?? 0));
  u.searchParams.set('count', String(opts.count ?? 18));
  u.searchParams.set('locate_query', 'false');
  u.searchParams.set('show_live_replay_strategy', '1');
  return u.toString();
}
