/**
 * BilibiliSearchSpider
 *
 * 按关键词搜索 Bilibili 视频，支持分页。
 *
 * 必填 params：
 *   - query    : 搜索关键词
 *
 * 可选 params：
 *   - maxPages : 最多翻几页（默认 5）
 *   - order    : 排序方式（totalrank / click / pubdate / dm / stow，默认 totalrank）
 *   - pageSize : 每页视频数（默认 30，上限 50）
 */

import { BaseSpider, type SpiderContext } from '../../../core/spider';
import { ApiClient } from '../../../fetcher/api';
import { buildSearchUrl, BILI_HEADERS } from '../helpers';
import type { BiliSearchResponse } from '../parsers';
import { searchItemToPayload } from '../parsers';
import { logger } from '../../../utils/logger';

// 导入平台注册副作用
import '../index';

export class BilibiliSearchSpider extends BaseSpider {
  override readonly name = 'bilibili-search';
  override readonly maxDepth = 30;

  readonly platform = 'bilibili';

  private readonly query: string;
  private readonly maxPages: number;
  private readonly order: 'totalrank' | 'click' | 'pubdate' | 'dm' | 'stow';
  private readonly pageSize: number;

  private readonly client: ApiClient;

  constructor(params?: Record<string, unknown>) {
    super();
    this.query = String(params?.query ?? '');
    this.maxPages = Number(params?.maxPages ?? 5);
    this.order = (params?.order as typeof this.order) ?? 'totalrank';
    this.pageSize = Math.min(Number(params?.pageSize ?? 30), 50);
    this.client = new ApiClient({
      perRequestDelayMs: 500,
      defaultHeaders: BILI_HEADERS,
    });
  }

  override get startUrls(): ReadonlyArray<{ url: string; type?: string }> {
    if (!this.query) {
      logger.warn({ spider: this.name }, 'BilibiliSearchSpider: query 未设置，startUrls 为空');
      return [];
    }
    return [
      {
        url: buildSearchUrl({
          query: this.query,
          page: 1,
          pageSize: this.pageSize,
          order: this.order,
        }),
        type: 'page:1',
      },
    ];
  }

  override async parse(ctx: SpiderContext): Promise<void> {
    const { url, type: jobType } = ctx;

    if (!jobType?.startsWith('page:')) return;
    const pageNum = Number(jobType.split(':')[1] ?? 1);

    let body: BiliSearchResponse;
    try {
      const res = await this.client.get<BiliSearchResponse>(url);
      body = res.data;
    } catch {
      logger.error({ url }, 'BilibiliSearchSpider: 请求失败');
      return;
    }

    if (body.code !== 0) {
      logger.error({ url, code: body.code, message: body.message }, 'Bilibili search 返回错误');
      return;
    }

    const results = body.data?.result ?? [];
    const totalPages = body.data?.numPages ?? 1;

    for (const item of results) {
      const payload = searchItemToPayload(item);
      ctx.emit({
        url: `https://www.bilibili.com/video/${item.bvid}`,
        type: 'video',
        platform: 'bilibili',
        kind: 'video',
        sourceId: item.bvid,
        payload,
      });
    }

    if (results.length > 0 && pageNum < totalPages && pageNum < this.maxPages) {
      ctx.enqueue({
        url: buildSearchUrl({
          query: this.query,
          page: pageNum + 1,
          pageSize: this.pageSize,
          order: this.order,
        }),
        type: `page:${pageNum + 1}`,
        depth: ctx.depth,
      });
    }
  }
}
