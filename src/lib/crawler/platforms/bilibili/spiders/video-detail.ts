/**
 * BilibiliVideoDetailSpider
 *
 * 抓取指定 Bilibili 视频的完整详情：简介、分 P 列表、标签、全套互动数据。
 *
 * 必填 params：
 *   - bvids   : BV 号列表——JSON 数组字符串、逗号分隔字符串或单个 BV 号
 *
 * 可选 params：
 *   - delayMs : 每次请求间隔毫秒（默认 1000）
 *
 * 接口：GET https://api.bilibili.com/x/web-interface/view?bvid=BVxxxxxxx
 * 公开接口，无需登录。
 */

import { BaseSpider, type SpiderContext } from '../../../core/spider';
import { ApiClient } from '../../../fetcher/api';
import { buildVideoDetailUrl, BILI_HEADERS } from '../helpers';
import type { BiliVideoDetailResponse } from '../parsers';
import { videoDetailToPayload } from '../parsers';
import { logger } from '../../../utils/logger';

// 导入平台注册副作用
import '../index';

export class BilibiliVideoDetailSpider extends BaseSpider {
  override readonly name = 'bilibili-video-detail';
  override readonly maxDepth = 1;

  readonly platform = 'bilibili';

  private readonly bvids: string[];
  private readonly client: ApiClient;

  constructor(params?: Record<string, unknown>) {
    super();

    const raw = params?.bvids;
    if (Array.isArray(raw)) {
      this.bvids = raw.map(String).filter(Boolean);
    } else if (typeof raw === 'string' && raw.trim()) {
      const trimmed = raw.trim();
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          this.bvids = Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [trimmed];
        } catch {
          this.bvids = [trimmed];
        }
      } else {
        this.bvids = trimmed
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } else {
      this.bvids = [];
    }

    const delayMs = Number(params?.delayMs ?? 1000);
    const proxyUrls = Array.isArray(params?.proxyUrls) ? (params.proxyUrls as string[]) : undefined;
    this.client = new ApiClient({
      perRequestDelayMs: delayMs,
      proxyUrls,
      defaultHeaders: BILI_HEADERS,
    });
  }

  override get startUrls(): ReadonlyArray<{ url: string; type?: string }> {
    if (this.bvids.length === 0) {
      logger.warn({ spider: this.name }, 'BilibiliVideoDetailSpider: bvids 未设置，startUrls 为空');
      return [];
    }
    return this.bvids.map((bvid, i) => ({
      url: `bilibili://video-detail?bvid=${encodeURIComponent(bvid)}`,
      type: `video:${i}`,
    }));
  }

  override async parse(ctx: SpiderContext): Promise<void> {
    const urlObj = new URL(ctx.url);
    const bvid = urlObj.searchParams.get('bvid') ?? '';
    if (!bvid) return;

    const apiUrl = buildVideoDetailUrl(bvid);

    let resp: BiliVideoDetailResponse;
    try {
      const res = await this.client.get<BiliVideoDetailResponse>(apiUrl);
      resp = res.data;
    } catch (err) {
      logger.error({ spider: this.name, bvid, err }, 'BilibiliVideoDetailSpider: 请求失败');
      return;
    }

    if (resp.code !== 0 || !resp.data) {
      logger.error(
        { spider: this.name, code: resp.code, message: resp.message, bvid },
        'BilibiliVideoDetailSpider: 接口返回错误',
      );
      return;
    }

    const payload = videoDetailToPayload(resp.data);
    ctx.emit({
      url: `https://www.bilibili.com/video/${bvid}`,
      type: 'video',
      platform: 'bilibili',
      kind: 'video',
      sourceId: bvid,
      payload,
    });
  }
}
