/**
 * YouTube 平台描述对象。
 *
 * 调用 registerPlatform() 注册到全局注册表；
 * 文件被首次 import 时自动执行副作用。
 */
import { registerPlatform, type Platform } from '../_base';

export const YouTubePlatform: Platform = {
  id: 'youtube',
  displayName: 'YouTube',
  fetcherKind: 'api',
  requiresJsRender: false,

  auth: {
    kind: 'apikey',
    // API key 直接追加到 URL querystring，inject 逻辑由 Spider 自己处理
    inject: undefined,
  },

  defaults: {
    // Data API v3 默认配额：10,000 units/day；search 消耗 100 units/次，videos 消耗 1 unit/次
    // 保守间隔 300 ms，避免突发超速
    perHostIntervalMs: 300,
    concurrency: 3,
    proxyTier: 'none',
    uaPool: 'desktop',
  },

  extractSourceId(url: string): string | null {
    try {
      const u = new URL(url);
      // https://www.youtube.com/watch?v=VIDEO_ID
      const v = u.searchParams.get('v');
      if (v) return v;
      // https://youtu.be/VIDEO_ID
      if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
      // https://www.googleapis.com/youtube/v3/... — API URL，不提取 sourceId
      return null;
    } catch {
      return null;
    }
  },

  respectsRobotsTxt: false, // Data API 不适用 robots.txt
  tosUrl: 'https://developers.google.com/youtube/terms/api-services-terms-of-service',
};

// 注册副作用：模块 import 时即完成注册
registerPlatform(YouTubePlatform);
