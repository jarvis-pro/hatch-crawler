/**
 * XhsSearchSpider
 *
 * 抓取小红书关键词搜索结果笔记。
 *
 * 必填 params：
 *   - query      : 搜索关键词
 *   - cookie     : 从浏览器复制的完整 cookie 字符串（由 job-handler 从 accounts 表自动注入）
 *
 * 可选 params：
 *   - maxPages   : 最多翻页数（默认 5）
 *   - pageSize   : 每页结果数（默认 20，上限 20）
 *   - sort       : general | time_descending | popularity_descending（默认 general）
 *   - noteType   : 0=不限 1=视频 2=图文（默认 0）
 *
 * 接口：POST /api/sns/web/v1/search/notes
 * 需要 Cookie + X-s/X-t 签名（由 buildXhsHeaders 注入）。
 */

import { BaseSpider, type SpiderContext } from '../../../core/spider';
import { ApiClient } from '../../../fetcher/api';
import { buildSearchBody, buildXhsHeaders, SEARCH_PATH, SEARCH_URL } from '../helpers';
import type { XhsSearchResponse } from '../parsers';
import { searchNoteToPayload } from '../parsers';
import { logger } from '../../../utils/logger';

// 导入平台注册副作用
import '../index';

export class XhsSearchSpider extends BaseSpider {
  override readonly name = 'xhs-search';
  override readonly maxDepth = 30;

  readonly platform = 'xhs';

  private readonly query: string;
  private readonly maxPages: number;
  private readonly pageSize: number;
  private readonly sort: 'general' | 'time_descending' | 'popularity_descending';
  private readonly noteType: 0 | 1 | 2;
  private readonly cookie: string;

  private readonly client: ApiClient;

  constructor(params?: Record<string, unknown>) {
    super();
    this.query = String(params?.query ?? '');
    this.maxPages = Number(params?.maxPages ?? 5);
    this.pageSize = Math.min(Number(params?.pageSize ?? 20), 20);
    this.sort = (params?.sort as typeof this.sort) ?? 'general';
    this.noteType = (params?.noteType as typeof this.noteType) ?? 0;
    this.cookie = String(params?.cookie ?? '');
    this.client = new ApiClient({ perRequestDelayMs: 1500 });
  }

  override get startUrls(): ReadonlyArray<{ url: string; type?: string }> {
    if (!this.query) {
      logger.warn({ spider: this.name }, 'XhsSearchSpider: query 未设置，startUrls 为空');
      return [];
    }
    // 用虚拟 URL 触发首次 parse；实际请求在 parse() 里发起
    return [{ url: `xhs://search?q=${encodeURIComponent(this.query)}&page=1`, type: 'page:1' }];
  }

  override async parse(ctx: SpiderContext): Promise<void> {
    const { type: jobType } = ctx;
    if (!jobType?.startsWith('page:')) return;
    const pageNum = Number(jobType.split(':')[1] ?? 1);

    const body = buildSearchBody({
      keyword: this.query,
      page: pageNum,
      pageSize: this.pageSize,
      sort: this.sort,
      noteType: this.noteType,
    });

    const headers = buildXhsHeaders(this.cookie, SEARCH_PATH, body);

    let resp: XhsSearchResponse;
    try {
      const res = await this.client.post<XhsSearchResponse>(SEARCH_URL, body, headers);
      resp = res.data;
    } catch (err) {
      logger.error({ spider: this.name, page: pageNum, err }, 'XhsSearchSpider: 请求失败');
      return;
    }

    if (resp.code !== 0) {
      logger.error(
        { spider: this.name, code: resp.code, msg: resp.msg },
        'XhsSearchSpider: 接口返回错误（可能需要更新 cookie 或签名）',
      );
      return;
    }

    const items = resp.data?.items ?? [];
    for (const item of items) {
      if (item.model_type !== 'note' || !item.note_card) continue;
      const payload = searchNoteToPayload(item.id, item.note_card);
      const kind = item.note_card.type === 'video' ? 'video' : 'post';
      ctx.emit({
        url: `https://www.xiaohongshu.com/explore/${item.id}`,
        type: kind,
        platform: 'xhs',
        kind,
        sourceId: item.id,
        payload,
      });
    }

    // 继续翻页
    const hasMore = resp.data?.has_more ?? false;
    if (hasMore && items.length > 0 && pageNum < this.maxPages) {
      ctx.enqueue({
        url: `xhs://search?q=${encodeURIComponent(this.query)}&page=${pageNum + 1}`,
        type: `page:${pageNum + 1}`,
        depth: ctx.depth,
      });
    }
  }
}
