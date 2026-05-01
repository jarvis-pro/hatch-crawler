/**
 * YoutubeChannelVideosSpider
 *
 * 抓取指定 YouTube 频道的所有视频（按上传时间倒序分页）。
 *
 * 必填 params：
 *   - apiKey    : YouTube Data API v3 key
 *   - channelId : 频道 ID（UC 开头）
 *
 * 可选 params：
 *   - maxResults : 每页最多视频数（默认 50，上限 50）
 *   - order      : 排序方式，默认 "date"
 *   - maxPages   : 最多翻几页（默认 20，防止无限分页）
 *
 * 抓取流程：
 *   1. search.list（type=video, channelId=?） → 一批 videoId
 *   2. videos.list（ids=...）                → 完整 snippet + contentDetails + statistics
 *   3. 如果 nextPageToken 存在且未超 maxPages → 继续下一页 search
 */

import { BaseSpider, type SpiderContext } from '../../../core/spider';
import { buildSearchUrl, buildVideosUrl } from '../helpers';
import type { YTSearchResponse, YTVideosResponse } from '../parsers';
import { videoItemToPayload } from '../parsers';
import { logger } from '../../../utils/logger';

// 导入平台注册副作用
import '../index';

export class YoutubeChannelVideosSpider extends BaseSpider {
  override readonly name = 'youtube-channel-videos';
  override readonly maxDepth = 60; // search 分页 + videos detail，层数较多

  readonly platform = 'youtube';

  private readonly apiKey: string;
  private readonly channelId: string;
  private readonly maxResults: number;
  private readonly order: 'date' | 'relevance' | 'viewCount' | 'rating' | 'title';
  private readonly maxPages: number;

  constructor(params?: Record<string, unknown>) {
    super();
    this.apiKey = String(params?.apiKey ?? '');
    this.channelId = String(params?.channelId ?? '');
    this.maxResults = Math.min(Number(params?.maxResults ?? 50), 50);
    this.order = (params?.order as typeof this.order) ?? 'date';
    this.maxPages = Number(params?.maxPages ?? 20);
  }

  override get startUrls(): ReadonlyArray<{ url: string; type?: string }> {
    if (!this.channelId || !this.apiKey) {
      logger.warn(
        { spider: this.name },
        'YoutubeChannelVideosSpider: apiKey 或 channelId 未设置，startUrls 为空',
      );
      return [];
    }
    return [
      {
        url: buildSearchUrl({
          apiKey: this.apiKey,
          channelId: this.channelId,
          maxResults: this.maxResults,
          order: this.order,
        }),
        type: 'search:0', // 格式：search:<pageIndex>，用于限制翻页
      },
    ];
  }

  override async parse(ctx: SpiderContext): Promise<void> {
    const { type: jobType } = ctx;

    // ── videos.list 详情 ──────────────────────────────────────────────────────
    if (jobType === 'videos') {
      let body: YTVideosResponse;
      try {
        body = JSON.parse(ctx.response.body) as YTVideosResponse;
      } catch {
        ctx.log('error', 'YouTube videos.list JSON 解析失败');
        return;
      }

      if (body.error) {
        ctx.log('error', `YouTube videos.list API 错误：${body.error.message}`, {
          code: body.error.code,
          channelId: this.channelId,
        });
        return;
      }

      const items = body.items ?? [];
      if (items.length === 0) {
        ctx.log('warn', 'YouTube videos.list 返回 0 items（请求的 videoId 可能已删除/私密）', {
          channelId: this.channelId,
        });
        return;
      }

      for (const item of items) {
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
        ctx.log('error', 'YouTube search.list JSON 解析失败');
        return;
      }

      if (body.error) {
        ctx.log('error', `YouTube search.list API 错误：${body.error.message}`, {
          code: body.error.code,
          channelId: this.channelId,
          pageIndex,
        });
        return;
      }

      // 提取 videoId 列表
      const videoIds = (body.items ?? [])
        .map((i) => i.id.videoId)
        .filter((id): id is string => Boolean(id));

      // 第一页空响应通常意味着 channelId 错 / 频道无视频 / 地区屏蔽——必须可见。
      // 后续分页空响应是正常翻页结尾，不告警。
      if (videoIds.length === 0 && pageIndex === 0) {
        ctx.log(
          'warn',
          `YouTube search.list 返回 0 items（channelId=${this.channelId}，可能 ID 错误/频道无视频/被地区屏蔽）`,
          {
            channelId: this.channelId,
            totalResults: body.pageInfo?.totalResults ?? null,
            regionCode: body.regionCode ?? null,
          },
        );
      }

      if (videoIds.length > 0) {
        // 批量拉取完整视频信息
        ctx.enqueue({
          url: buildVideosUrl({ apiKey: this.apiKey, ids: videoIds }),
          type: 'videos',
          depth: ctx.depth + 1,
        });
      }

      // 分页：下一页
      if (body.nextPageToken && pageIndex + 1 < this.maxPages) {
        ctx.enqueue({
          url: buildSearchUrl({
            apiKey: this.apiKey,
            channelId: this.channelId,
            maxResults: this.maxResults,
            order: this.order,
            pageToken: body.nextPageToken,
          }),
          type: `search:${pageIndex + 1}`,
          depth: ctx.depth, // 分页不增加 depth
        });
      }
    }
  }
}
