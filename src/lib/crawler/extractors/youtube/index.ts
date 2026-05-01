/**
 * YouTube Extractor —— 从 watch 页 HTML 提取视频元数据。
 *
 * 不依赖 YouTube Data API、不依赖第三方库、不需要登录。
 * 走的是 youtube.com 自己塞在页面里的 ytInitialPlayerResponse JSON。
 *
 * 覆盖的 URL 形态：
 *   https://www.youtube.com/watch?v=VIDEO_ID
 *   https://m.youtube.com/watch?v=VIDEO_ID
 *   https://youtu.be/VIDEO_ID
 *   https://www.youtube.com/shorts/VIDEO_ID
 *   https://www.youtube.com/embed/VIDEO_ID
 *   https://www.youtube.com/v/VIDEO_ID
 *
 * 全部标准化为：https://www.youtube.com/watch?v=VIDEO_ID
 */

import type { SpiderContext } from '../../core/spider';
import type { Extractor, VideoMetadata } from '../types';
import { ExtractorError } from '../types';
import { extractPlayerResponse, type YtInitialPlayerResponse } from './html-parser';

/** 11 位 YouTube videoId */
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const HOST_PATTERNS = [
  /^(www\.|m\.)?youtube\.com$/i,
  /^youtube-nocookie\.com$/i,
  /^www\.youtube-nocookie\.com$/i,
  /^youtu\.be$/i,
];

/** 把 base host 归一为 www.youtube.com，短链直接重组路径 */
function isYoutubeHost(host: string): boolean {
  return HOST_PATTERNS.some((re) => re.test(host));
}

/**
 * 从各种 URL 形态里抠出 11 位 videoId。
 * 抠不到返回 null，让上层抛 NOT_SUPPORTED。
 */
function extractVideoId(url: URL): string | null {
  const host = url.hostname.toLowerCase();

  // 1. youtu.be/VIDEO_ID
  if (host === 'youtu.be') {
    const id = url.pathname.replace(/^\/+/, '').split('/')[0] ?? '';
    return VIDEO_ID_RE.test(id) ? id : null;
  }

  // 2. /watch?v=VIDEO_ID
  if (url.pathname === '/watch') {
    const v = url.searchParams.get('v');
    return v && VIDEO_ID_RE.test(v) ? v : null;
  }

  // 3. /shorts/VIDEO_ID, /embed/VIDEO_ID, /v/VIDEO_ID, /live/VIDEO_ID
  const m = /^\/(?:shorts|embed|v|live)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
  if (m && m[1]) return m[1];

  return null;
}

/** 把毫秒级 ISO 字符串拼出来 —— YouTube 给的 publishDate 多是 YYYY-MM-DD */
function toIsoDatetime(date: string | undefined): string | undefined {
  if (!date) return undefined;
  // 已经是带时区的 ISO？直接返回
  if (/T\d{2}:\d{2}/.test(date)) {
    const d = new Date(date);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  // 纯日期 YYYY-MM-DD → 补零时分秒
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return `${date}T00:00:00.000Z`;
  }
  // 兜底：丢给 Date 试试
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function safeInt(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 把 playabilityStatus 翻译成 ExtractorErrorCode。
 * 仅在 status !== 'OK' 时调用。
 */
function classifyPlayabilityStatus(
  status: string,
  reason: string,
): { code: import('../types').ExtractorErrorCode; message: string } {
  const r = reason.toLowerCase();

  if (status === 'LOGIN_REQUIRED') {
    if (r.includes('age')) return { code: 'AGE_RESTRICTED', message: reason };
    return { code: 'PRIVATE', message: reason };
  }
  if (status === 'ERROR') {
    if (r.includes('not available') && r.includes('country')) {
      return { code: 'REGION_LOCKED', message: reason };
    }
    return { code: 'NOT_FOUND', message: reason };
  }
  if (status === 'UNPLAYABLE') {
    if (r.includes('private')) return { code: 'PRIVATE', message: reason };
    return { code: 'NOT_FOUND', message: reason };
  }
  // 未知状态，按解析失败处理
  return { code: 'PARSE_FAILED', message: `unexpected playabilityStatus: ${status} (${reason})` };
}

function buildVideoMetadata(
  videoId: string,
  canonicalUrl: string,
  pr: YtInitialPlayerResponse,
): VideoMetadata {
  const vd = pr.videoDetails;
  const mf = pr.microformat?.playerMicroformatRenderer;

  if (!vd?.title) {
    throw new ExtractorError('PARSE_FAILED', 'videoDetails.title 缺失');
  }

  const lengthSec = safeInt(vd.lengthSeconds);
  const durationMs = lengthSec !== undefined ? lengthSec * 1000 : undefined;

  // 缩略图：取 videoDetails.thumbnail.thumbnails，按宽度降序，最多 5 张
  const thumbnails = (vd.thumbnail?.thumbnails ?? [])
    .slice()
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
    .slice(0, 5)
    .map((t) => ({
      kind: 'thumbnail' as const,
      url: t.url,
      ...(t.width !== undefined ? { width: t.width } : {}),
      ...(t.height !== undefined ? { height: t.height } : {}),
    }));

  const channelId = vd.channelId ?? mf?.externalChannelId;
  const authorName = vd.author ?? mf?.ownerChannelName;
  const author =
    authorName && channelId
      ? {
          id: channelId,
          name: authorName,
          ...(mf?.ownerProfileUrl
            ? {
                url: mf.ownerProfileUrl.startsWith('http')
                  ? mf.ownerProfileUrl
                  : `https://www.youtube.com${mf.ownerProfileUrl}`,
              }
            : { url: `https://www.youtube.com/channel/${channelId}` }),
        }
      : undefined;

  const views = safeInt(vd.viewCount);
  const publishedAt = toIsoDatetime(mf?.publishDate ?? mf?.uploadDate);

  // 描述优先用 microformat（含换行和完整文本），其次 shortDescription
  const description = mf?.description?.simpleText ?? vd.shortDescription;

  const item: VideoMetadata = {
    platform: 'youtube',
    kind: 'video',
    sourceId: videoId,
    url: canonicalUrl,
    title: vd.title,
    ...(description ? { description } : {}),
    ...(author ? { author } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(vd.keywords && vd.keywords.length > 0 ? { tags: vd.keywords } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(views !== undefined ? { metrics: { views } } : {}),
    ...(thumbnails.length > 0 ? { media: thumbnails } : {}),
    raw: {
      isLiveContent: vd.isLiveContent ?? false,
      category: mf?.category,
      availableCountries: mf?.availableCountries,
    },
  };

  return item;
}

export const youtubeExtractor: Extractor = {
  name: 'youtube',
  urlPatterns: HOST_PATTERNS,

  match(url: URL): boolean {
    if (!isYoutubeHost(url.hostname)) return false;
    return extractVideoId(url) !== null;
  },

  canonicalize(url: URL): string {
    const id = extractVideoId(url);
    if (!id) {
      // canonicalize 不应抛错（registry 会先调 match），保险起见返回原 URL
      return url.toString();
    }
    return `https://www.youtube.com/watch?v=${id}`;
  },

  extractId(url: URL): string {
    const id = extractVideoId(url);
    if (!id) {
      throw new ExtractorError(
        'NOT_SUPPORTED',
        `URL 不是合法的 YouTube 视频链接：${url.toString()}`,
      );
    }
    return id;
  },

  async extract(ctx: SpiderContext): Promise<VideoMetadata> {
    const url = new URL(ctx.url);
    const videoId = extractVideoId(url);
    if (!videoId) {
      throw new ExtractorError('NOT_SUPPORTED', `无法提取 videoId：${ctx.url}`);
    }
    const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

    const pr = extractPlayerResponse(ctx.response.body);
    if (!pr) {
      // YouTube 同意墙偶尔会返回不含 ytInitialPlayerResponse 的精简页
      throw new ExtractorError(
        'PARSE_FAILED',
        `页面未包含 ytInitialPlayerResponse（可能命中同意墙/反爬）`,
      );
    }

    // 先看 playabilityStatus，区分"视频不可用"和"页面正常但解析失败"
    const status = pr.playabilityStatus?.status;
    const reason =
      pr.playabilityStatus?.reason ??
      pr.playabilityStatus?.errorScreen?.playerErrorMessageRenderer?.subreason?.simpleText ??
      pr.playabilityStatus?.errorScreen?.playerErrorMessageRenderer?.reason?.simpleText ??
      'unknown';

    if (status && status !== 'OK') {
      const { code, message } = classifyPlayabilityStatus(status, reason);
      throw new ExtractorError(code, message);
    }

    return buildVideoMetadata(videoId, canonicalUrl, pr);
  },
};
