import 'server-only';
import { BaseSpider } from '@/lib/crawler';
import { YoutubeChannelVideosSpider } from '@/lib/crawler/platforms/youtube/spiders/channel-videos';
import { YoutubeSearchSpider } from '@/lib/crawler/platforms/youtube/spiders/search';
import { BilibiliUserVideosSpider } from '@/lib/crawler/platforms/bilibili/spiders/user-videos';
import { BilibiliSearchSpider } from '@/lib/crawler/platforms/bilibili/spiders/search';
import { BilibiliVideoDetailSpider } from '@/lib/crawler/platforms/bilibili/spiders/video-detail';
import { XhsSearchSpider } from '@/lib/crawler/platforms/xhs/spiders/search';
import { XhsUserNotesSpider } from '@/lib/crawler/platforms/xhs/spiders/user-notes';
import { XhsNoteDetailSpider } from '@/lib/crawler/platforms/xhs/spiders/note-detail';
import { XhsNoteCommentsSpider } from '@/lib/crawler/platforms/xhs/spiders/note-comments';
import { WeiboSearchSpider } from '@/lib/crawler/platforms/weibo/spiders/search';
import { WeiboUserPostsSpider } from '@/lib/crawler/platforms/weibo/spiders/user-posts';
import { DouyinSearchSpider } from '@/lib/crawler/platforms/douyin/spiders/search';
import { DouyinUserVideosSpider } from '@/lib/crawler/platforms/douyin/spiders/user-videos';

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
  'youtube-channel-videos': {
    factory: (params) => new YoutubeChannelVideosSpider(params),
    platform: 'youtube',
  },
  'youtube-search': {
    factory: (params) => new YoutubeSearchSpider(params),
    platform: 'youtube',
  },
  'bilibili-user-videos': {
    factory: (params) => new BilibiliUserVideosSpider(params),
    platform: 'bilibili',
  },
  'bilibili-search': {
    factory: (params) => new BilibiliSearchSpider(params),
    platform: 'bilibili',
  },
  'bilibili-video-detail': {
    factory: (params) => new BilibiliVideoDetailSpider(params),
    platform: 'bilibili',
  },
  'xhs-search': {
    factory: (params) => new XhsSearchSpider(params),
    platform: 'xhs',
  },
  'xhs-user-notes': {
    factory: (params) => new XhsUserNotesSpider(params),
    platform: 'xhs',
  },
  'xhs-note-detail': {
    factory: (params) => new XhsNoteDetailSpider(params),
    platform: 'xhs',
  },
  'xhs-note-comments': {
    factory: (params) => new XhsNoteCommentsSpider(params),
    platform: 'xhs',
  },
  'weibo-search': {
    factory: (params) => new WeiboSearchSpider(params),
    platform: 'weibo',
  },
  'weibo-user-posts': {
    factory: (params) => new WeiboUserPostsSpider(params),
    platform: 'weibo',
  },
  'douyin-search': {
    factory: (params) => new DouyinSearchSpider(params),
    platform: 'douyin',
  },
  'douyin-user-videos': {
    factory: (params) => new DouyinUserVideosSpider(params),
    platform: 'douyin',
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
