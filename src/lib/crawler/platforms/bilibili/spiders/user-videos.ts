/**
 * BilibiliUserVideosSpider
 *
 * 抓取指定 UP 主的所有投稿视频（按上传时间倒序分页）。
 *
 * 必填 params：
 *   - uid      : UP 主 UID（纯数字）
 *
 * 可选 params：
 *   - maxPages : 最多翻几页（默认 10）
 *   - order    : 排序方式（pubdate / click / stow，默认 pubdate）
 *   - pageSize : 每页视频数（默认 30，上限 50）
 *
 * 接口：GET /x/space/arc/search
 * 不需要凭据，但需要 Referer 头（由 ApiClient.defaultHeaders 注入）。
 *
 * 抓取流程：
 *   1. 第一页 → 解析总数、计算总页数
 *   2. emit VideoItem
 *   3. 如果还有下一页且未超 maxPages → 继续入队
 */

import { BaseSpider, type SpiderContext } from '../../../core/spider';
import { ApiClient } from '../../../fetcher/api';
import { buildUserVideosUrl, BILI_HEADERS } from '../helpers';
import type { BiliSpaceArcResponse } from '../parsers';
import { vlistItemToPayload } from '../parsers';
import { logger } from '../../../utils/logger';

// 导入平台注册副作用
import '../index';

export class BilibiliUserVideosSpider extends BaseSpider {
  override readonly name = 'bilibili-user-videos';
  override readonly maxDepth = 60;

  readonly platform = 'bilibili';

  private readonly uid: string;
  private readonly maxPages: number;
  private readonly order: 'pubdate' | 'click' | 'stow';
  private readonly pageSize: number;

  // 独立 ApiClient：注入 Bilibili 必需的 Referer 等 headers
  private readonly client: ApiClient;

  constructor(params?: Record<string, unknown>) {
    super();
    this.uid = String(params?.uid ?? '');
    this.maxPages = Number(params?.maxPages ?? 10);
    this.order = (params?.order as typeof this.order) ?? 'pubdate';
    this.pageSize = Math.min(Number(params?.pageSize ?? 30), 50);
    this.client = new ApiClient({
      perRequestDelayMs: 500,
      defaultHeaders: BILI_HEADERS,
    });
  }

  override get startUrls(): ReadonlyArray<{ url: string; type?: string }> {
    if (!this.uid) {
      logger.warn({ spider: this.name }, 'BilibiliUserVideosSpider: uid 未设置，startUrls 为空');
      return [];
    }
    return [
      {
        url: buildUserVideosUrl({
          uid: this.uid,
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

    // 直接用 ApiClient 重新请求，避免依赖 Fetcher 注入 headers
    // （ctx.response.body 是 Fetcher 拿到的，可能缺 Referer，这里走独立客户端）
    let body: BiliSpaceArcResponse;
    try {
      const res = await this.client.get<BiliSpaceArcResponse>(url);
      body = res.data;
    } catch {
      logger.error({ url }, 'BilibiliUserVideosSpider: 请求失败');
      return;
    }

    if (body.code !== 0) {
      logger.error(
        { url, code: body.code, message: body.message },
        'Bilibili /x/space/arc/search 返回错误',
      );
      return;
    }

    const vlist = body.data?.list?.vlist ?? [];
    const totalCount = body.data?.page?.count ?? 0;
    const totalPages = Math.ceil(totalCount / this.pageSize);

    for (const item of vlist) {
      const payload = vlistItemToPayload(item);
      ctx.emit({
        url: `https://www.bilibili.com/video/${item.bvid}`,
        type: 'video',
        platform: 'bilibili',
        kind: 'video',
        sourceId: item.bvid,
        payload,
      });
    }

    // 分页：下一页
    if (vlist.length > 0 && pageNum < totalPages && pageNum < this.maxPages) {
      ctx.enqueue({
        url: buildUserVideosUrl({
          uid: this.uid,
          page: pageNum + 1,
          pageSize: this.pageSize,
          order: this.order,
        }),
        type: `page:${pageNum + 1}`,
        depth: ctx.depth, // 分页不增加 depth
      });
    }
  }
}
