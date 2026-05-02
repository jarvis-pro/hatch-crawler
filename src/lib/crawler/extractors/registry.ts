/**
 * Extractor 注册表：按 host 路由 URL 到对应平台 extractor。
 *
 * 新增平台只需：
 *   1. 在对应子目录实现 Extractor
 *   2. 在 `extractorRegistry` 数组里 push 一行（generic 永远最后）
 *
 * 不要在这里写任何"哪家平台特殊"的 if-else——平台知识属于 extractor 自己。
 */

import { youtubeExtractor } from './youtube';
import type { Extractor } from './types';

/**
 * 注册表本身。顺序决定优先级：第一个 match 命中的 extractor 接管。
 * 将来加 TikTok/Bilibili/Generic 时，generic 一定要放在最后。
 */
export const extractorRegistry: readonly Extractor[] = [youtubeExtractor];

export interface DispatchResult {
  extractor: Extractor;
  /** 已 canonicalize 的 URL */
  canonicalUrl: string;
}

/**
 * 根据 URL 字符串找到对应 extractor。
 *
 * 失败原因：
 *  - URL 格式非法（new URL 抛错）→ 返回 null
 *  - 没有 extractor 认这个 host → 返回 null
 *
 * 调用方（/api/extract → extract worker）：null 直接归类为 unsupported，不入队。
 */
export function dispatch(rawUrl: string): DispatchResult | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const extractor = extractorRegistry.find((e) => e.match(url));
  if (!extractor) return null;

  return {
    extractor,
    canonicalUrl: extractor.canonicalize(url),
  };
}

export type { Extractor, ExtractorErrorCode, VideoMetadata } from './types';
export { ExtractorError } from './types';
