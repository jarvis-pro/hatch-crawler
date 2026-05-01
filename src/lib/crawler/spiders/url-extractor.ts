/**
 * UrlExtractorSpider —— 按用户传入的 URL 列表逐条提取视频元数据。
 *
 * 设计要点：
 *  1. 不属于任何单一平台。Spider 本身只做调度：拿 URL → 走 extractor 注册表 → emit。
 *  2. params.urls 来自 /api/extract 的请求体（→ runs.overrides.urls）。
 *  3. 构造时对每个 URL 做 canonicalize，把噪声参数去掉，
 *     这样数据库里 items.url 是干净的 canonical 形态。
 *  4. 单 URL 失败只 ctx.log error，不抛错——一次 run 内允许部分成功，
 *     run 整体仍走 completed，failureCount 不会因此 +1（配合 spider-registry 的
 *     excludeFromAutoDisable，整套机制确保用户粘几个失效链接不会把这个 spider 关掉）。
 *
 * 新增平台（TikTok / B 站 / Generic）只要在 extractors 目录下加一个 Extractor，
 * 在 extractors/registry.ts 里 push 一行即可，不必改本文件。
 */

import { BaseSpider, type SpiderContext } from '../core/spider';
import { logger } from '../utils/logger';
import { dispatch, ExtractorError } from '../extractors/registry';

interface UrlExtractorParams {
  /** 待提取的 URL 列表（来自 overrides.urls） */
  urls?: unknown;
}

export class UrlExtractorSpider extends BaseSpider {
  override readonly name = 'url-extractor';
  /** 每条 URL 是独立 seed，不会派生新 URL，maxDepth=0 已足够 */
  override readonly maxDepth = 0;

  private readonly _startUrls: ReadonlyArray<{ url: string; type: string }>;

  constructor(params?: Record<string, unknown>) {
    super();
    const p = (params ?? {}) as UrlExtractorParams;
    const raw = Array.isArray(p.urls) ? (p.urls as unknown[]) : [];

    const seeds: { url: string; type: string }[] = [];
    for (const item of raw) {
      const s = typeof item === 'string' ? item.trim() : '';
      if (s.length === 0) continue;

      const result = dispatch(s);
      if (result) {
        seeds.push({ url: result.canonicalUrl, type: 'extract' });
      } else {
        // 不认识的 URL 也加进去——让 parse 时统一走 ctx.log 路径，
        // 用户能在 events 表里看到"哪条 URL 被跳了"。
        seeds.push({ url: s, type: 'extract' });
        logger.warn(
          { spider: this.name, url: s },
          'UrlExtractorSpider: 没有 extractor 认这个 URL，将在 parse 阶段记错跳过',
        );
      }
    }

    this._startUrls = seeds;
  }

  override get startUrls(): ReadonlyArray<{ url: string; type?: string }> {
    return this._startUrls;
  }

  override async parse(ctx: SpiderContext): Promise<void> {
    const result = dispatch(ctx.url);
    if (!result) {
      ctx.log('error', `不支持的 URL 形态，没有 extractor 能处理：${ctx.url}`, {
        code: 'NOT_SUPPORTED',
      });
      return;
    }

    const { extractor } = result;

    try {
      const item = await extractor.extract(ctx);
      ctx.emit({
        url: item.url,
        type: 'video',
        platform: item.platform,
        kind: item.kind,
        sourceId: item.sourceId,
        payload: item as unknown as Record<string, unknown>,
      });
    } catch (err) {
      if (err instanceof ExtractorError) {
        // 业务错误：用 ctx.log 落事件 + run.errors +1，但不抛——run 仍按 completed 收尾
        ctx.log('error', `[${extractor.name}] ${err.code}: ${err.message}`, {
          extractor: extractor.name,
          code: err.code,
        });
        return;
      }
      // 未知错误向外抛，由引擎捕获记 stats.errors+1（同样不会让 run failed）
      throw err;
    }
  }
}
