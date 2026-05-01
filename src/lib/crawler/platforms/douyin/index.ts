/**
 * 抖音平台描述对象。
 */
import { registerPlatform, type Platform } from '../_base';

export const DouyinPlatform: Platform = {
  id: 'douyin',
  displayName: '抖音',
  fetcherKind: 'api',
  requiresJsRender: false,

  auth: {
    kind: 'cookie',
    // Cookie 由 Spider 构造时从 params.cookie 手动注入到 headers
    inject: undefined,
  },

  defaults: {
    perHostIntervalMs: 2000,
    concurrency: 1,
    proxyTier: 'residential',
    uaPool: 'mobile',
  },

  extractSourceId(url: string): string | null {
    try {
      const u = new URL(url);
      // https://www.douyin.com/video/7123456789012345678
      const m = u.pathname.match(/\/video\/(\d+)/);
      return m?.[1] ?? null;
    } catch {
      return null;
    }
  },

  respectsRobotsTxt: false,
  tosUrl: 'https://www.douyin.com/about/terms',
};

registerPlatform(DouyinPlatform);
