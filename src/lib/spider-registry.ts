import 'server-only';
import { z } from 'zod';
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
import { UrlExtractorSpider } from '@/lib/crawler/spiders/url-extractor';

/**
 * Spider 注册表：name → 入口描述。
 *
 * factory 接受可选 params（job overrides + 平台凭据注入），
 * 让 Spider 在构造时就拿到 apiKey、channelId 等运行时参数。
 *
 * platform 字段标记该 Spider 所属平台；
 * job-handler 会自动从 accounts 表查询对应平台的活跃凭据，
 * 以 `apiKey` / `cookie` 等 key 注入到 params 中。
 *
 * excludeFromAutoDisable 字段：标记某些"用户输入驱动"的 spider，
 * 让 worker 跳过 consecutive_failures 累加 / 自动停用逻辑。
 * 例：url-extractor 的失败多源于用户粘贴失效链接，不应让整个功能被关闭。
 *
 * paramSchema：描述该 spider 接受的运行时参数结构，
 * 供表单自动渲染和参数校验使用。
 *
 * description：对用户展示的一句话说明。
 */

type SpiderFactory = (params?: Record<string, unknown>) => BaseSpider;

export interface SpiderEntry {
  factory: SpiderFactory;
  /** 平台 ID（与 accounts.platform、items.platform 一致），用于自动注入凭据 */
  platform?: string;
  /**
   * 是否豁免连续失败自动停用机制。
   * worker 命中此标记时不会调 spiderRepo.recordFailure / resetFailures。
   */
  excludeFromAutoDisable?: boolean;
  /**
   * 运行时参数 Zod schema。
   * 用于表单自动渲染（label / 类型 / 必填 / 默认值）和参数预校验。
   * 未填时前端回退到 JSON 编辑器。
   */
  paramSchema?: z.ZodType;
  /** 一句话功能说明，在创建任务界面展示 */
  description?: string;
}

export const SPIDER_REGISTRY: Record<string, SpiderEntry> = {
  'youtube-channel-videos': {
    factory: (params) => new YoutubeChannelVideosSpider(params),
    platform: 'youtube',
    description: '抓取 YouTube 频道的全部视频',
    paramSchema: z.object({
      channelId: z.string().min(1).describe('频道 ID（如 UCxxxxxx）'),
      maxResults: z.number().int().min(1).max(500).default(50).describe('最多抓取数量'),
    }),
  },
  'youtube-search': {
    factory: (params) => new YoutubeSearchSpider(params),
    platform: 'youtube',
    description: '按关键词搜索 YouTube 视频',
    paramSchema: z.object({
      query: z.string().min(1).describe('搜索关键词'),
      maxResults: z.number().int().min(1).max(200).default(50).describe('最多抓取数量'),
    }),
  },
  'bilibili-user-videos': {
    factory: (params) => new BilibiliUserVideosSpider(params),
    platform: 'bilibili',
    description: '抓取 B 站 UP 主的投稿视频',
    paramSchema: z.object({
      userId: z.string().min(1).describe('UP 主 UID'),
      maxResults: z.number().int().min(1).max(500).default(100).describe('最多抓取数量'),
    }),
  },
  'bilibili-search': {
    factory: (params) => new BilibiliSearchSpider(params),
    platform: 'bilibili',
    description: '按关键词搜索 B 站视频',
    paramSchema: z.object({
      query: z.string().min(1).describe('搜索关键词'),
      maxResults: z.number().int().min(1).max(200).default(50).describe('最多抓取数量'),
    }),
  },
  'bilibili-video-detail': {
    factory: (params) => new BilibiliVideoDetailSpider(params),
    platform: 'bilibili',
    description: '抓取 B 站单个视频详情',
    paramSchema: z.object({
      bvid: z.string().min(1).describe('视频 BV 号（如 BV1xxxxxxx）'),
    }),
  },
  'xhs-search': {
    factory: (params) => new XhsSearchSpider(params),
    platform: 'xhs',
    description: '按关键词搜索小红书笔记',
    paramSchema: z.object({
      keyword: z.string().min(1).describe('搜索关键词'),
      maxResults: z.number().int().min(1).max(200).default(50).describe('最多抓取数量'),
    }),
  },
  'xhs-user-notes': {
    factory: (params) => new XhsUserNotesSpider(params),
    platform: 'xhs',
    description: '抓取小红书用户的所有笔记',
    paramSchema: z.object({
      userId: z.string().min(1).describe('用户 ID'),
      maxResults: z.number().int().min(1).max(500).default(100).describe('最多抓取数量'),
    }),
  },
  'xhs-note-detail': {
    factory: (params) => new XhsNoteDetailSpider(params),
    platform: 'xhs',
    description: '抓取小红书单篇笔记详情',
    paramSchema: z.object({
      noteId: z.string().min(1).describe('笔记 ID'),
    }),
  },
  'xhs-note-comments': {
    factory: (params) => new XhsNoteCommentsSpider(params),
    platform: 'xhs',
    description: '抓取小红书笔记下的所有评论',
    paramSchema: z.object({
      noteId: z.string().min(1).describe('笔记 ID'),
      maxResults: z.number().int().min(1).max(1000).default(200).describe('最多抓取评论数'),
    }),
  },
  'weibo-search': {
    factory: (params) => new WeiboSearchSpider(params),
    platform: 'weibo',
    description: '按关键词搜索微博',
    paramSchema: z.object({
      keyword: z.string().min(1).describe('搜索关键词'),
      maxResults: z.number().int().min(1).max(500).default(100).describe('最多抓取数量'),
    }),
  },
  'weibo-user-posts': {
    factory: (params) => new WeiboUserPostsSpider(params),
    platform: 'weibo',
    description: '抓取微博用户的所有发布',
    paramSchema: z.object({
      userId: z.string().min(1).describe('微博用户 ID'),
      maxResults: z.number().int().min(1).max(1000).default(200).describe('最多抓取数量'),
    }),
  },
  'douyin-search': {
    factory: (params) => new DouyinSearchSpider(params),
    platform: 'douyin',
    description: '按关键词搜索抖音视频',
    paramSchema: z.object({
      keyword: z.string().min(1).describe('搜索关键词'),
      maxResults: z.number().int().min(1).max(200).default(50).describe('最多抓取数量'),
    }),
  },
  'douyin-user-videos': {
    factory: (params) => new DouyinUserVideosSpider(params),
    platform: 'douyin',
    description: '抓取抖音用户主页的所有视频',
    paramSchema: z.object({
      userId: z.string().min(1).describe('抖音用户 ID（sec_uid）'),
      maxResults: z.number().int().min(1).max(500).default(100).describe('最多抓取数量'),
    }),
  },
  'url-extractor': {
    factory: (params) => new UrlExtractorSpider(params),
    // 不绑定单一平台——它按 URL 分发到对应 extractor
    excludeFromAutoDisable: true,
    description: '粘贴 URL 列表，自动识别平台并抓取详情',
    paramSchema: z.object({
      urls: z.array(z.string().url()).min(1).describe('URL 列表（每行一条）'),
    }),
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

/**
 * 将 Zod schema 序列化为 JSON Schema（简化版）供前端消费。
 * 只处理 ZodObject 的一级字段，满足参数表单渲染需求。
 */
export function serializeParamSchema(schema: z.ZodType | undefined): unknown {
  if (!schema) return null;

  try {
    // 若安装了 zod-to-json-schema 则用它，否则手写简化版
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { zodToJsonSchema } = require('zod-to-json-schema') as {
      zodToJsonSchema: (s: z.ZodType) => unknown;
    };
    return zodToJsonSchema(schema);
  } catch {
    // 降级：手写简化输出
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape as Record<string, z.ZodTypeAny>;
      const properties: Record<string, { type: string; description?: string; default?: unknown }> =
        {};
      const required: string[] = [];

      for (const [key, field] of Object.entries(shape)) {
        let inner: z.ZodTypeAny = field;
        let hasDefault = false;
        let defaultValue: unknown;

        // 剥 ZodDefault
        if (inner instanceof z.ZodDefault) {
          hasDefault = true;
          defaultValue = inner._def.defaultValue();
          inner = inner._def.innerType as z.ZodTypeAny;
        }
        // 剥 ZodOptional
        const optional = inner instanceof z.ZodOptional;
        if (optional) inner = (inner as z.ZodOptional<z.ZodTypeAny>).unwrap();

        const desc =
          (field._def as { description?: string }).description ??
          (inner._def as { description?: string }).description;

        const typeMap: Record<string, string> = {
          ZodString: 'string',
          ZodNumber: 'number',
          ZodBoolean: 'boolean',
          ZodArray: 'array',
        };
        const typeName = inner._def.typeName as string;
        properties[key] = {
          type: typeMap[typeName] ?? 'string',
          ...(desc ? { description: desc } : {}),
          ...(hasDefault ? { default: defaultValue } : {}),
        };
        if (!optional && !hasDefault) required.push(key);
      }

      return { type: 'object', properties, required };
    }
    return null;
  }
}
