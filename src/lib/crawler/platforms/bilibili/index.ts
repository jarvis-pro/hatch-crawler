/**
 * Bilibili 平台描述对象。
 */
import { registerPlatform, type Platform } from '../_base';

export const BilibiliPlatform: Platform = {
  id: 'bilibili',
  displayName: 'Bilibili',
  fetcherKind: 'api',
  requiresJsRender: false,

  auth: {
    kind: 'none',
    // 公开数据无需鉴权；若需要访问登录内容可切换为 cookie 模式
    inject: undefined,
  },

  defaults: {
    // Bilibili 对高频请求较敏感，间隔适当放宽
    perHostIntervalMs: 500,
    concurrency: 2,
    proxyTier: 'none',
    uaPool: 'desktop',
  },

  extractSourceId(url: string): string | null {
    try {
      const u = new URL(url);
      // https://www.bilibili.com/video/BV1xx411c7mD
      const m = u.pathname.match(/\/video\/(BV\w+)/i);
      return m?.[1] ?? null;
    } catch {
      return null;
    }
  },

  respectsRobotsTxt: false,
  tosUrl: 'https://www.bilibili.com/protocal/licence.html',
};

registerPlatform(BilibiliPlatform);
