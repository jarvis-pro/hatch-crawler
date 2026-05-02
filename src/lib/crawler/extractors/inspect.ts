/**
 * Client-safe URL 检测：只跑 URL parse + match + canonicalize，
 * 不触发任何 fetch / HTML 解析 / Node API。
 *
 * 暴露给前端的 /extract 输入框使用：在用户每次输入时立即识别 URL 所属平台，
 * 命中即给绿灯（带 platform 徽章），未命中即标灰（不再下发执行）。
 *
 * 注意：本文件只能从 server-safe 子集 import，不要 import core/spider 的运行时
 * （core/spider 里有 fetcher / queue 等会拉进 server-only 链路的成员）。
 * 当前扩展器实现里 match/canonicalize/extractId 都是纯函数，bundle 进 client
 * 仅多带几 KB 静态字符串（HTML 解析路径运行时不执行），可接受。
 */

import { extractorRegistry } from './registry';

export type InspectResult =
  | { kind: 'invalid'; rawUrl: string; reason: string }
  | { kind: 'unsupported'; rawUrl: string; host: string }
  | {
      kind: 'supported';
      rawUrl: string;
      platform: string;
      canonicalUrl: string;
      sourceId: string;
    };

/**
 * 推断单条 URL 的归属。
 * 调用方根据 kind 决定 UI 表现 / 是否下发到后端。
 */
export function inspect(rawUrl: string): InspectResult {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) {
    return { kind: 'invalid', rawUrl, reason: 'empty' };
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { kind: 'invalid', rawUrl: trimmed, reason: 'malformed' };
  }

  const extractor = extractorRegistry.find((e) => e.match(url));
  if (!extractor) {
    return { kind: 'unsupported', rawUrl: trimmed, host: url.hostname };
  }

  // canonicalize 与 extractId 都是 match 通过后才允许调用的纯函数
  const canonicalUrl = extractor.canonicalize(url);
  let sourceId: string;
  try {
    sourceId = extractor.extractId(url);
  } catch {
    // 防御：理论上 match=true 即可 extractId；万一抛错降级为 unsupported
    return { kind: 'unsupported', rawUrl: trimmed, host: url.hostname };
  }

  return {
    kind: 'supported',
    rawUrl: trimmed,
    platform: extractor.name,
    canonicalUrl,
    sourceId,
  };
}

/**
 * 已注册的所有平台名（按注册顺序），UI 可用作"目前支持哪些平台"提示。
 */
export function listSupportedPlatforms(): string[] {
  return extractorRegistry.map((e) => e.name);
}
