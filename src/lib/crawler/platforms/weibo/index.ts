/**
 * 微博平台描述对象。
 */
import { registerPlatform, type Platform } from '../_base';

export const WeiboPlatform: Platform = {
  id: 'weibo',
  displayName: '微博',
  fetcherKind: 'api',
  requiresJsRender: false,

  auth: {
    kind: 'cookie',
    // Cookie 由 Spider 构造时从 params.cookie 手动注入到 headers，无需平台层注入
    inject: undefined,
  },

  defaults: {
    perHostIntervalMs: 1000,
    concurrency: 2,
    proxyTier: 'residential',
    uaPool: 'desktop',
  },

  extractSourceId(url: string): string | null {
    try {
      const u = new URL(url);
      // https://weibo.com/1234567890/AbCdEfG
      const m = u.pathname.match(/\/(\d+)\/(\w+)/);
      return m ? `${m[1]}_${m[2]}` : null;
    } catch {
      return null;
    }
  },

  respectsRobotsTxt: false,
  tosUrl: 'https://weibo.com/signup/v5/protocol',
};

registerPlatform(WeiboPlatform);
