/**
 * Extractor 抽象层：把"按 URL 抽取单个视频"的平台知识从 Spider 中剥离。
 *
 * 设计意图：
 *  - Spider（url-extractor）只做调度：拿 URL → 调注册表 → emit 结果
 *  - Extractor 封装平台知识：URL 匹配、URL 标准化、ID 提取、HTML/API 解析
 *  - 新增平台 = 新建一个 Extractor + 在 registry 注册一行，零 if-else
 *
 * 输出形状对齐 src/lib/crawler/kinds/video.ts 的 VideoItem，
 * 保证 PostgresStorage 的软校验能直接通过。
 */

import type { SpiderContext } from '../core/spider';
import type { VideoItem } from '../kinds/video';

/**
 * Extractor 错误码。
 *
 * 决定 worker 如何处理：
 *  - NOT_SUPPORTED / NOT_FOUND / PRIVATE / AGE_RESTRICTED / REGION_LOCKED：
 *    永久失败，不重试，事件 level='error'。
 *  - RATE_LIMITED / NETWORK_ERROR：
 *    临时失败，pg-boss 自带重试可处理；事件 level='warn'。
 *  - PARSE_FAILED：
 *    平台改版，需要人介入；事件 level='error' 触发告警。
 */
export type ExtractorErrorCode =
  | 'NOT_SUPPORTED'
  | 'NOT_FOUND'
  | 'PRIVATE'
  | 'AGE_RESTRICTED'
  | 'REGION_LOCKED'
  | 'RATE_LIMITED'
  | 'PARSE_FAILED'
  | 'NETWORK_ERROR';

export class ExtractorError extends Error {
  public readonly code: ExtractorErrorCode;

  constructor(code: ExtractorErrorCode, message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'ExtractorError';
    this.code = code;
  }
}

/**
 * Extractor 产出的视频元数据。
 * 直接复用 VideoItem schema —— 它就是我们想要的 VideoMetadata 形状。
 */
export type VideoMetadata = VideoItem;

export interface Extractor {
  /**
   * 平台标识，与 items.platform / accounts.platform 对齐。
   * 例：'youtube' | 'tiktok' | 'bilibili'
   */
  readonly name: string;

  /**
   * 用于路由的 URL 模式。registry 按数组顺序匹配，第一个命中即赢。
   * generic 兜底 extractor 应该放在最后。
   */
  readonly urlPatterns: RegExp[];

  /**
   * 判断该 URL 是否归本 extractor 处理。
   * 默认实现遍历 urlPatterns 做 host+pathname 匹配；可重写做更精细判断。
   */
  match(url: URL): boolean;

  /**
   * 标准化 URL：
   *  - 统一域名（m.youtube.com → www.youtube.com）
   *  - 短链展开（youtu.be/abc → www.youtube.com/watch?v=abc）
   *  - 去掉 utm_* / si / feature 等噪声参数
   *
   * 标准化后的 URL 用作 startUrls 与最终 item.url。
   */
  canonicalize(url: URL): string;

  /**
   * 提取平台内唯一 ID，作为 items.source_id 写入。
   * `(platform, source_id)` 是数据库部分唯一索引：同一视频跨 spider/run 只一行。
   */
  extractId(url: URL): string;

  /**
   * 主提取函数：基于 ctx.response.body 解析出完整 VideoMetadata。
   * 失败时抛 ExtractorError，由 spider 捕获并记 ctx.log error。
   */
  extract(ctx: SpiderContext): Promise<VideoMetadata>;
}
