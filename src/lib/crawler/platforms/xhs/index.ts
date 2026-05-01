/**
 * 小红书（XHS）平台描述对象。
 *
 * 鉴权方式：Cookie（需从浏览器复制完整 cookie 字符串，存入 accounts 表）。
 * 小红书接口还要求 X-s / X-t 签名 header；签名算法由 helpers.ts 的
 * generateSign() 提供，默认占位实现，可按需替换。
 */
import { registerPlatform, type Platform } from '../_base';

export const XhsPlatform: Platform = {
  id: 'xhs',
  displayName: '小红书',
  fetcherKind: 'api',
  requiresJsRender: false,

  auth: {
    kind: 'cookie',
    inject: undefined, // 由 Spider 自行注入 header
  },

  defaults: {
    // 小红书限流较严，间隔放宽
    perHostIntervalMs: 1500,
    concurrency: 1,
    proxyTier: 'none',
    uaPool: 'desktop',
  },

  extractSourceId(url: string): string | null {
    try {
      const u = new URL(url);
      // https://www.xiaohongshu.com/explore/noteId
      const m = u.pathname.match(/\/explore\/([a-f0-9]+)/i);
      return m?.[1] ?? null;
    } catch {
      return null;
    }
  },

  respectsRobotsTxt: false,
  tosUrl: 'https://www.xiaohongshu.com/terms',
};

registerPlatform(XhsPlatform);
