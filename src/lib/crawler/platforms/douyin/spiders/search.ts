/**
 * DouyinSearchSpider
 *
 * 抓取抖音关键词搜索视频结果。
 *
 * 必填 params：
 *   - keyword   : 搜索关键词
 *
 * 可选 params：
 *   - maxPages  : 最多翻页数（默认 5）
 *   - pageSize  : 每页数量（默认 10，最大 20）
 *   - cookie    : 登录 Cookie（由 job-handler 从 accounts 表自动注入）
 *   - delayMs   : 每次请求间隔毫秒（默认 2000）
 *   - proxyUrls : 代理列表（由 job-handler 从 settings 注入）
 *
 * 接口：GET https://www.douyin.com/aweme/v1/web/search/item/
 */

import { BaseSpider, type SpiderContext } from '../../../core/spider';
import { ApiClient } from '../../../fetcher/api';
import { buildSearchUrl, DOUYIN_HEADERS } from '../helpers';
import type { DouyinSearchResponse } from '../parsers';
import { awemeToPayload } from '../parsers';
import { logger } from '../../../utils/logger';

import '../index';

export class DouyinSearchSpider extends BaseSpider {
  override readonly name = 'douyin-search';
  override readonly maxDepth = 1;

  readonly platform = 'douyin';

  private readonly keyword: string;
  private readonly maxPages: number;
  private readonly pageSize: number;
  private readonly client: ApiClient;

  constructor(params?: Record<string, unknown>) {
    super();
    this.keyword = String(params?.keyword ?? '').trim();
    this.maxPages = Number(params?.maxPages ?? 5);
    this.pageSize = Math.min(Number(params?.pageSize ?? 10), 20);

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
    if (!this.keyword) {
      logger.warn({ spider: this.name }, 'DouyinSearchSpider: keyword 未设置');
      return [];
    }
    return Array.from({ length: this.maxPages }, (_, i) => ({
      url: `douyin://search?keyword=${encodeURIComponent(this.keyword)}&offset=${i * this.pageSize}`,
      type: `page:${i + 1}`,
    }));
  }

  override async parse(ctx: SpiderContext): Promise<void> {
    const urlObj = new URL(ctx.url);
    const keyword = decodeURIComponent(urlObj.searchParams.get('keyword') ?? '');
    const offset = Number(urlObj.searchParams.get('offset') ?? '0');
    if (!keyword) return;

    const apiUrl = buildSearchUrl({ keyword, offset, count: this.pageSize });

    let resp: DouyinSearchResponse;
    try {
      const res = await this.client.get<DouyinSearchResponse>(apiUrl);
      resp = res.data;
    } catch (err) {
      logger.error({ spider: this.name, keyword, offset, err }, 'DouyinSearchSpider: 请求失败');
      return;
    }

    if (resp.status_code !== 0 || !resp.data) {
      logger.warn(
        { spider: this.name, keyword, offset, status: resp.status_code },
        'DouyinSearchSpider: 无数据',
      );
      return;
    }

    let count = 0;
    for (const item of resp.data) {
      const aweme = item.aweme_info;
      if (!aweme) continue;
      const payload = awemeToPayload(aweme);
      ctx.emit({
        url: aweme.share_url ?? `https://www.douyin.com/video/${aweme.aweme_id}`,
        type: 'video',
        platform: 'douyin',
        kind: 'video',
        sourceId: aweme.aweme_id,
        payload,
      });
      count++;
    }

    logger.info({ spider: this.name, keyword, offset, count }, 'DouyinSearchSpider: 本页抓取完成');
  }
}
