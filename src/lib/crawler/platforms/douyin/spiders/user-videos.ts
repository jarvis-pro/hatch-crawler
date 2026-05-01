/**
 * DouyinUserVideosSpider
 *
 * 抓取指定抖音用户发布的视频列表（游标翻页）。
 *
 * 必填 params：
 *   - secUid    : 用户 sec_uid（抖音内部长 ID，从个人主页 URL 中获取）
 *
 * 可选 params：
 *   - maxPages  : 最多翻页数（默认 10）
 *   - pageSize  : 每页数量（默认 18）
 *   - cookie    : 登录 Cookie（由 job-handler 从 accounts 表自动注入）
 *   - delayMs   : 每次请求间隔毫秒（默认 2000）
 *   - proxyUrls : 代理列表（由 job-handler 从 settings 注入）
 *
 * 接口：GET https://www.douyin.com/aweme/v1/web/aweme/post/
 * 游标翻页：初始 maxCursor=0，响应中的 max_cursor 作为下页入参。
 */

import { BaseSpider, type SpiderContext } from '../../../core/spider';
import { ApiClient } from '../../../fetcher/api';
import { buildUserVideosUrl, DOUYIN_HEADERS } from '../helpers';
import type { DouyinUserVideosResponse } from '../parsers';
import { awemeToPayload } from '../parsers';
import { logger } from '../../../utils/logger';

import '../index';

export class DouyinUserVideosSpider extends BaseSpider {
  override readonly name = 'douyin-user-videos';
  override readonly maxDepth = 1;

  readonly platform = 'douyin';

  private readonly secUid: string;
  private readonly maxPages: number;
  private readonly pageSize: number;
  private readonly client: ApiClient;

  constructor(params?: Record<string, unknown>) {
    super();
    this.secUid = String(params?.secUid ?? '').trim();
    this.maxPages = Number(params?.maxPages ?? 10);
    this.pageSize = Number(params?.pageSize ?? 18);

    const cookie = params?.cookie ? String(params.cookie) : undefined;
    const delayMs = Number(params?.delayMs ?? 2000);
    const proxyUrls = Array.isArray(params?.proxyUrls) ? (params.proxyUrls as string[]) : undefined;

    this.client = new ApiClient({
      perRequestDelayMs: delayMs,
      proxyUrls,
      defaultHeaders: {
        ...DOUYIN_HEADERS,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
  }

  override get startUrls(): ReadonlyArray<{ url: string; type?: string }> {
    if (!this.secUid) {
      logger.warn({ spider: this.name }, 'DouyinUserVideosSpider: secUid 未设置');
      return [];
    }
    // 初始入口只有一个，游标翻页通过 ctx.enqueue 实现
    return [
      {
        url: `douyin://user-videos?secUid=${encodeURIComponent(this.secUid)}&cursor=0&page=1`,
        type: 'page:1',
      },
    ];
  }

  override async parse(ctx: SpiderContext): Promise<void> {
    const urlObj = new URL(ctx.url);
    const secUid = decodeURIComponent(urlObj.searchParams.get('secUid') ?? '');
    const cursor = Number(urlObj.searchParams.get('cursor') ?? '0');
    const pageNum = Number(urlObj.searchParams.get('page') ?? '1');
    if (!secUid) return;

    const apiUrl = buildUserVideosUrl({ secUid, maxCursor: cursor, count: this.pageSize });

    let resp: DouyinUserVideosResponse;
    try {
      const res = await this.client.get<DouyinUserVideosResponse>(apiUrl);
      resp = res.data;
    } catch (err) {
      logger.error({ spider: this.name, secUid, cursor, err }, 'DouyinUserVideosSpider: 请求失败');
      return;
    }

    if (resp.status_code !== 0 || !resp.aweme_list) {
      logger.warn(
        { spider: this.name, secUid, cursor, status: resp.status_code },
        'DouyinUserVideosSpider: 无数据',
      );
      return;
    }

    for (const aweme of resp.aweme_list) {
      const payload = awemeToPayload(aweme);
      ctx.emit({
        url: aweme.share_url ?? `https://www.douyin.com/video/${aweme.aweme_id}`,
        type: 'video',
        platform: 'douyin',
        kind: 'video',
        sourceId: aweme.aweme_id,
        payload,
      });
    }

    logger.info(
      { spider: this.name, secUid, cursor, count: resp.aweme_list.length },
      'DouyinUserVideosSpider: 本页抓取完成',
    );

    // 游标翻页：有下一页且未超过 maxPages 时入队
    if (resp.has_more && resp.max_cursor && pageNum < this.maxPages) {
      ctx.enqueue({
        url: `douyin://user-videos?secUid=${encodeURIComponent(secUid)}&cursor=${resp.max_cursor}&page=${pageNum + 1}`,
        type: `page:${pageNum + 1}`,
      });
    }
  }
}
