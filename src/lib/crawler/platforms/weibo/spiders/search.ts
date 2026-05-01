/**
 * WeiboSearchSpider
 *
 * 抓取微博关键词搜索结果。
 *
 * 必填 params：
 *   - query     : 搜索关键词
 *
 * 可选 params：
 *   - maxPages  : 最多翻页数（默认 5）
 *   - cookie    : 登录 Cookie（由 job-handler 从 accounts 表自动注入）
 *   - delayMs   : 每次请求间隔毫秒（默认 1500）
 *   - proxyUrls : 代理列表（由 job-handler 从 settings 注入）
 *
 * 接口：GET https://m.weibo.cn/api/container/getIndex?containerid=...
 */

import { BaseSpider, type SpiderContext } from '../../../core/spider';
import { ApiClient } from '../../../fetcher/api';
import { buildSearchUrl, WEIBO_HEADERS } from '../helpers';
import { type WeiboContainerResponse, extractPostsFromCards, postToPayload } from '../parsers';
import { logger } from '../../../utils/logger';

import '../index';

export class WeiboSearchSpider extends BaseSpider {
  override readonly name = 'weibo-search';
  override readonly maxDepth = 1;

  readonly platform = 'weibo';

  private readonly query: string;
  private readonly maxPages: number;
  private readonly client: ApiClient;

  constructor(params?: Record<string, unknown>) {
    super();
    this.query = String(params?.query ?? '');
    this.maxPages = Number(params?.maxPages ?? 5);

    const cookie = params?.cookie ? String(params.cookie) : undefined;
    const delayMs = Number(params?.delayMs ?? 1500);
    const proxyUrls = Array.isArray(params?.proxyUrls) ? (params.proxyUrls as string[]) : undefined;

    this.client = new ApiClient({
      perRequestDelayMs: delayMs,
      proxyUrls,
      defaultHeaders: {
        ...WEIBO_HEADERS,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
  }

  override get startUrls(): ReadonlyArray<{ url: string; type?: string }> {
    if (!this.query) {
      logger.warn({ spider: this.name }, 'WeiboSearchSpider: query 未设置');
      return [];
    }
    return Array.from({ length: this.maxPages }, (_, i) => ({
      url: `weibo://search?query=${encodeURIComponent(this.query)}&page=${i + 1}`,
      type: `page:${i + 1}`,
    }));
  }

  override async parse(ctx: SpiderContext): Promise<void> {
    const urlObj = new URL(ctx.url);
    const query = decodeURIComponent(urlObj.searchParams.get('query') ?? '');
    const page = Number(urlObj.searchParams.get('page') ?? '1');
    if (!query) return;

    const apiUrl = buildSearchUrl({ query, page });

    let resp: WeiboContainerResponse;
    try {
      const res = await this.client.get<WeiboContainerResponse>(apiUrl);
      resp = res.data;
    } catch (err) {
      logger.error({ spider: this.name, query, page, err }, 'WeiboSearchSpider: 请求失败');
      return;
    }

    if (resp.ok !== 1 || !resp.data?.cards) {
      logger.warn({ spider: this.name, query, page, ok: resp.ok }, 'WeiboSearchSpider: 无数据');
      return;
    }

    const posts = extractPostsFromCards(resp.data.cards);
    for (const post of posts) {
      const payload = postToPayload(post);
      ctx.emit({
        url: `https://weibo.com/${post.user?.id ?? ''}/${post.id}`,
        type: 'post',
        platform: 'weibo',
        kind: 'post',
        sourceId: post.id,
        payload,
      });
    }

    logger.info(
      { spider: this.name, query, page, count: posts.length },
      'WeiboSearchSpider: 本页抓取完成',
    );
  }
}
