/**
 * YoutubeSearchSpider
 *
 * 按关键词搜索 YouTube 视频，支持多页分页。
 *
 * 必填 params：
 *   - apiKey : YouTube Data API v3 key
 *   - query  : 搜索关键词
 *
 * 可选 params：
 *   - maxResults : 每页视频数（默认 50，上限 50）
 *   - order      : 排序方式（默认 "relevance"）
 *   - maxPages   : 最多翻几页（默认 5）
 *
 * 与 YoutubeChannelVideosSpider 流程相同：
 *   search.list → videos.list → emit VideoItem
 */

import { BaseSpider, type SpiderContext } from '../../../core/spider';
import { buildSearchUrl, buildVideosUrl } from '../helpers';
import type { YTSearchResponse, YTVideosResponse } from '../parsers';
import { videoItemToPayload } from '../parsers';
import { logger } from '../../../utils/logger';

// 导入平台注册副作用
import '../index';

export class YoutubeSearchSpider extends BaseSpider {
  override readonly name = 'youtube-search';
  override readonly maxDepth = 30;

  readonly platform = 'youtube';

  private readonly apiKey: string;
  private readonly query: string;
  private readonly maxResults: number;
  private readonly order: 'date' | 'relevance' | 'viewCount' | 'rating' | 'title';
  private readonly maxPages: number;

  constructor(params?: Record<string, unknown>) {
    super();
    this.apiKey = String(params?.apiKey ?? '');
    this.query = String(params?.query ?? '');
    this.maxResults = Math.min(Number(params?.maxResults ?? 50), 50);
    this.order = (params?.order as typeof this.order) ?? 'relevance';
    this.maxPages = Number(params?.maxPages ?? 5);
  }

  override get startUrls(): ReadonlyArray<{ url: string; type?: string }> {
    if (!this.query || !this.apiKey) {
      logger.warn(
        { spider: this.name },
        'YoutubeSearchSpider: apiKey 或 query 未设置，startUrls 为空',
      );
      return [];
    }
    return [
      {
        url: buildSearchUrl({
          apiKey: this.apiKey,
          q: this.query,
          maxResults: this.maxResults,
          order: this.order,
        }),
        type: 'search:0',
      },
    ];
  }

  override async parse(ctx: SpiderContext): Promise<void> {
    const { url, type: jobType } = ctx;

    // ── videos.list 详情 ──────────────────────────────────────────────────────
    if (jobType === 'videos') {
      let body: YTVideosResponse;
      try {
        body = JSON.parse(ctx.response.body) as YTVideosResponse;
      } catch {
        logger.error({ url }, 'YoutubeSearchSpider: videos.list JSON 解析失败');
        return;
      }

      if (body.error) {
        logger.error(
          { url, code: body.error.code, message: body.error.message },
          'YouTube videos.list 返回错误',
        );
        return;
      }

      for (const item of body.items ?? []) {
        const payload = videoItemToPayload(item);
        ctx.emit({
          url: `https://www.youtube.com/watch?v=${item.id}`,
          type: 'video',
          platform: 'youtube',
          kind: 'video',
          sourceId: item.id,
          payload,
        });
      }

      return;
    }

    // ── search.list 分页 ──────────────────────────────────────────────────────
    if (jobType?.startsWith('search:')) {
      const pageIndex = Number(jobType.split(':')[1] ?? 0);

      let body: YTSearchResponse;
      try {
        body = JSON.parse(ctx.response.body) as YTSearchResponse;
      } catch {
        logger.error({ url }, 'YoutubeSearchSpider: search.list JSON 解析失败');
        return;
      }

      if (body.error) {
        logger.error(
          { url, code: body.error.code, message: body.error.message },
          'YouTube search.list 返回错误',
        );
        return;
      }

      const videoIds = (body.items ?? [])
        .map((i) => i.id.videoId)
        .filter((id): id is string => Boolean(id));

      if (videoIds.length > 0) {
        ctx.enqueue({
          url: buildVideosUrl({ apiKey: this.apiKey, ids: videoIds }),
          type: 'videos',
          depth: ctx.depth + 1,
        });
      }

      if (body.nextPageToken && pageIndex + 1 < this.maxPages) {
        ctx.enqueue({
          url: buildSearchUrl({
            apiKey: this.apiKey,
            q: this.query,
            maxResults: this.maxResults,
            order: this.order,
            pageToken: body.nextPageToken,
          }),
          type: `search:${pageIndex + 1}`,
          depth: ctx.depth,
        });
      }
    }
  }
}
