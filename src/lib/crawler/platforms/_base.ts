/**
 * Platform 接口定义。
 *
 * 每个平台实现一个 Platform 描述对象，刻画"在这个站上抓任何东西的共性"。
 * Spider 通过 platform.id 查找对应的 Platform 对象，不把平台知识写死在自身里。
 */

export type FetcherKind = 'http' | 'api';
export type AuthKind = 'none' | 'cookie' | 'oauth' | 'apikey' | 'signed';
export type ProxyTier = 'none' | 'datacenter' | 'residential';
export type UaPool = 'desktop' | 'mobile' | 'platform-app';

export interface PlatformDefaults {
  /** 每个 host 的最小请求间隔（毫秒） */
  perHostIntervalMs: number;
  /** 并发数 */
  concurrency: number;
  proxyTier: ProxyTier;
  uaPool: UaPool;
}

export interface PlatformAuth {
  kind: AuthKind;
  /**
   * 按账号类型和 payload（已解密）注入鉴权参数到 URL / headers。
   * 如果 null 说明不需要特殊注入逻辑（比如 apikey 直接 append 到 URL）。
   */
  inject?: (url: string, headers: Record<string, string>, payload: string) => void;
}

export interface Platform {
  /** 平台唯一标识，与 accounts.platform / items.platform 保持一致 */
  id: string;
  displayName: string;

  /** 默认 fetch 策略 */
  fetcherKind: FetcherKind;
  requiresJsRender: boolean;

  /** 鉴权描述 */
  auth: PlatformAuth;

  /** 爬取默认偏好（可被 Run overrides 覆盖） */
  defaults: PlatformDefaults;

  /**
   * 从 URL 中提取平台原生 ID（用于去重）。
   * 比 URL 更稳定：跳过 CDN 域名变更、重定向等问题。
   */
  extractSourceId(url: string): string | null;

  /** 是否遵守 robots.txt */
  respectsRobotsTxt: boolean;
  tosUrl?: string;
}

/** 平台注册表：platform.id → Platform */
const PLATFORM_REGISTRY = new Map<string, Platform>();

export function registerPlatform(p: Platform): void {
  PLATFORM_REGISTRY.set(p.id, p);
}

export function getPlatform(id: string): Platform | null {
  return PLATFORM_REGISTRY.get(id) ?? null;
}

export function listPlatforms(): Platform[] {
  return [...PLATFORM_REGISTRY.values()];
}
