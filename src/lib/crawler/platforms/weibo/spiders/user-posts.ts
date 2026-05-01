/**
 * WeiboUserPostsSpider
 *
 * 抓取指定微博用户的微博列表。
 *
 * 必填 params：
 *   - uid       : 用户 UID（纯数字字符串，如 "1234567890"）
 *
 * 可选 params：
 *   - maxPages  : 最多翻页数（默认 10）
 *   - cookie    : 登录 Cookie（由 job-handler 从 accounts 表自动注入）
 *   - delayMs   : 每次请求间隔毫秒（默认 1500）
 *   - proxyUrls : 代理列表（由 job-handler 从 settings 注入）
 *
 * 接口：GET https://m.weibo.cn/api/container/getIndex?uid=<uid>&containerid=107603<uid>&page=<n>
 */

import { BaseSpider, type SpiderContext } from '../../../core/spider';
import { ApiClient } from '../../../fetcher/api';
import { buildUserPostsUrl, WEIBO_HEADERS } from '../helpers';
import { type WeiboContainerResponse, extractPostsFromCards, postToPayload } from '../parsers';
import { logger } from '../../../utils/logger';

import '../index';

export class WeiboUserPostsSpider extends BaseSpider {
  override readonly name = 'weibo-user-posts';
  override readonly maxDepth = 1;

  readonly platform = 'weibo';

  private readonly uid: string;
  private readonly maxPages: number;
  private readonly client: ApiClient;

  constructor(params?: Record<string, unknown>) {
    super();
    this.uid = String(params?.uid ?? '').trim();
    this.maxPages = Number(params?.maxPages ?? 10);

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
    if (!this.uid) {
      logger.warn({ spider: this.name }, 'WeiboUserPostsSpider: uid 未设置');
      return [];
    }
    return Array.from({ length: this.maxPages }, (_, i) => ({
      url: `weibo://user-posts?uid=${encodeURIComponent(this.uid)}&page=${i + 1}`,
      type: `page:${i + 1}`,
    }));
  }

  override async parse(ctx: SpiderContext): Promise<void> {
    const urlObj = new URL(ctx.url);
    const uid = decodeURIComponent(urlObj.searchParams.get('uid') ?? '');
    const page = Number(urlObj.searchParams.get('page') ?? '1');
    if (!uid) return;

    const apiUrl = buildUserPostsUrl({ uid, page });

    let resp: WeiboContainerResponse;
    try {
      const res = await this.client.get<WeiboContainerResponse>(apiUrl);
      resp = res.data;
    } catch (err) {
      logger.error({ spider: this.name, uid, page, err }, 'WeiboUserPostsSpider: 请求失败');
      return;
    }

    if (resp.ok !== 1 || !resp.data?.cards) {
      logger.warn(
        { spider: this.name, uid, page, ok: resp.ok },
        'WeiboUserPostsSpider: 无数据，可能已到末页',
      );
      return;
    }

    const posts = extractPostsFromCards(resp.data.cards);
    for (const post of posts) {
      const payload = postToPayload(post);
      ctx.emit({
        url: `https://weibo.com/${uid}/${post.id}`,
        type: 'post',
        platform: 'weibo',
        kind: 'post',
        sourceId: post.id,
        payload,
      });
    }

    logger.info(
      { spider: this.name, uid, page, count: posts.length },
      'WeiboUserPostsSpider: 本页抓取完成',
    );
  }
}
