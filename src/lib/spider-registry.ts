import 'server-only';
import { BaseSpider, NextJsBlogSpider } from '@/lib/crawler';
import { YoutubeChannelVideosSpider } from '@/lib/crawler/platforms/youtube/spiders/channel-videos';
import { YoutubeSearchSpider } from '@/lib/crawler/platforms/youtube/spiders/search';

/**
 * Spider 注册表：name → 入口描述。
 *
 * factory 接受可选 params（job overrides + 平台凭据注入），
 * 让 Spider 在构造时就拿到 apiKey、channelId 等运行时参数。
 *
 * platform 字段标记该 Spider 所属平台；
 * job-handler 会自动从 accounts 表查询对应平台的活跃凭据，
 * 以 `apiKey` / `cookie` 等 key 注入到 params 中。
 */

type SpiderFactory = (params?: Record<string, unknown>) => BaseSpider;

interface SpiderEntry {
  factory: SpiderFactory;
  /** 平台 ID（与 accounts.platform、items.platform 一致），用于自动注入凭据 */
  platform?: string;
}

export const SPIDER_REGISTRY: Record<string, SpiderEntry> = {
  'nextjs-blog': {
    factory: () => new NextJsBlogSpider(),
  },
  'youtube-channel-videos': {
    factory: (params) => new YoutubeChannelVideosSpider(params),
    platform: 'youtube',
  },
  'youtube-search': {
    factory: (params) => new YoutubeSearchSpider(params),
    platform: 'youtube',
  },
};

export function getSpiderEntry(name: string): SpiderEntry | null {
  return SPIDER_REGISTRY[name] ?? null;
}

/** @deprecated 仅为向后兼容保留；新代码请使用 getSpiderEntry */
export function getSpiderFactory(name: string): SpiderFactory | null {
  return SPIDER_REGISTRY[name]?.factory ?? null;
}

export function listSpiderNames(): string[] {
  return Object.keys(SPIDER_REGISTRY);
}
