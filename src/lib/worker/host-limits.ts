import 'server-only';

/**
 * RFC 0002 Phase C —— 下载队列内的 host 级串行化。
 *
 * pg-boss 没有原生的 host-aware rate limit；我们只对"风控敏感"站点（如 YouTube）
 * 在进程内做 mutex，避免同时跑多个 yt-dlp 触发风控/封禁。
 *
 * 实现：每个 host 一条 promise chain；新任务排在 chain 尾，前一个完成后才执行。
 */

const CACHE_KEY = '__hatchHostLocks';
type Holder = { [CACHE_KEY]?: Map<string, Promise<unknown>> };

function getMap(): Map<string, Promise<unknown>> {
  const holder = globalThis as unknown as Holder;
  if (!holder[CACHE_KEY]) holder[CACHE_KEY] = new Map();
  return holder[CACHE_KEY]!;
}

/** 把一个 task 排在指定 host 的串行队列尾。 */
async function withHostLock<T>(host: string, task: () => Promise<T>): Promise<T> {
  const map = getMap();
  const prev = map.get(host) ?? Promise.resolve();
  let resolveNext: () => void = () => {};
  const next = new Promise<void>((r) => {
    resolveNext = r;
  });
  map.set(host, next);

  try {
    await prev.catch(() => undefined);
    return await task();
  } finally {
    resolveNext();
    // 链尾不再扩展时清理，避免 Map 永久增长
    if (map.get(host) === next) map.delete(host);
  }
}

/** 判断一个 URL 是否属于 YouTube 家族 host */
export function isYoutubeUrl(url: string): boolean {
  try {
    const h = new URL(url).host.toLowerCase();
    return (
      h === 'youtube.com' || h.endsWith('.youtube.com') || h === 'youtu.be' || h === 'm.youtube.com'
    );
  } catch {
    return false;
  }
}

/** YouTube 类 URL 的串行化包装；非 YouTube 直接执行。 */
export function withYoutubeHostLock<T>(url: string, task: () => Promise<T>): Promise<T> {
  if (!isYoutubeUrl(url)) return task();
  return withHostLock('youtube', task);
}
