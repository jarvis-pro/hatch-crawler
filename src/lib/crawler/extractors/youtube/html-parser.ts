/**
 * 从 YouTube watch 页 HTML 中提取 `ytInitialPlayerResponse`。
 *
 * 这是 YouTube 自己塞在页面里给前端用的 JSON，
 * 包含 videoDetails / microformat / playabilityStatus / streamingData 等。
 * 字段最全、不需要 API key、不需要登录（公开视频），是最稳的纯元数据来源。
 *
 * 解析失败、JSON 不完整、字段缺失都视作 PARSE_FAILED 让上层处理。
 */

/**
 * 部分类型定义——只声明我们用到的字段。
 * `unknown` 字段保持原样，避免锁死 YouTube 内部格式变化。
 */
export interface YtInitialPlayerResponse {
  videoDetails?: {
    videoId?: string;
    title?: string;
    lengthSeconds?: string;
    keywords?: string[];
    channelId?: string;
    isOwnerViewing?: boolean;
    shortDescription?: string;
    isCrawlable?: boolean;
    thumbnail?: { thumbnails?: { url: string; width?: number; height?: number }[] };
    viewCount?: string;
    author?: string;
    isPrivate?: boolean;
    isUnpluggedCorpus?: boolean;
    isLiveContent?: boolean;
  };
  microformat?: {
    playerMicroformatRenderer?: {
      thumbnail?: { thumbnails?: { url: string; width?: number; height?: number }[] };
      embed?: { iframeUrl?: string; flashUrl?: string; width?: number; height?: number };
      title?: { simpleText?: string };
      description?: { simpleText?: string };
      lengthSeconds?: string;
      ownerProfileUrl?: string;
      externalChannelId?: string;
      ownerChannelName?: string;
      uploadDate?: string;
      publishDate?: string;
      category?: string;
      availableCountries?: string[];
    };
  };
  playabilityStatus?: {
    status?: string; // 'OK' | 'UNPLAYABLE' | 'LOGIN_REQUIRED' | 'ERROR' | ...
    reason?: string;
    errorScreen?: {
      playerErrorMessageRenderer?: {
        subreason?: { simpleText?: string };
        reason?: { simpleText?: string };
      };
    };
  };
}

/**
 * 截取 HTML 中的 `var ytInitialPlayerResponse = {...};` 段。
 *
 * 处理两种常见前缀：
 *   var ytInitialPlayerResponse = {...};
 *   ytInitialPlayerResponse = {...};
 *
 * 用平衡括号扫描而不是贪婪正则，避免 description 里嵌套花括号导致截断。
 */
export function extractPlayerResponse(html: string): YtInitialPlayerResponse | null {
  // 找到 ytInitialPlayerResponse = { 起始位置
  const markers = ['ytInitialPlayerResponse = {', 'ytInitialPlayerResponse={'];
  let start = -1;
  let braceStart = -1;
  for (const marker of markers) {
    const idx = html.indexOf(marker);
    if (idx >= 0) {
      start = idx;
      braceStart = idx + marker.length - 1; // 指向那个 {
      break;
    }
  }
  if (start < 0 || braceStart < 0) return null;

  // 平衡括号扫描，处理字符串内的转义和括号
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = braceStart; i < html.length; i++) {
    const ch = html[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return null;

  const json = html.slice(braceStart, end + 1);
  try {
    return JSON.parse(json) as YtInitialPlayerResponse;
  } catch {
    return null;
  }
}
