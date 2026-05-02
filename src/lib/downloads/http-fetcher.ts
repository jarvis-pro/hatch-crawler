import 'server-only';
import got, { HTTPError } from 'got';
import path from 'node:path';

import { type FileStorage, buildAttachmentPath, type PutResult } from '@/lib/storage/files';

/**
 * HTTP 直链下载 fetcher —— RFC 0002 Phase A
 *
 * 用 got stream 接 downloadProgress；写文件 + 算 sha256 都在 FileStorage 里完成。
 */

export interface HttpFetcherInput {
  attachmentId: string;
  spider: string;
  itemId: string;
  sourceUrl: string;
  /** 可选 hint：如果 spider 已知文件后缀，传过来；否则从 URL / Content-Type 嗅 */
  extHint?: string;
}

export interface HttpFetcherCtx {
  signal: AbortSignal;
  /** 进度回调；调用方负责节流（每 2s 或 +5%） */
  onProgress: (pct: number, bytes: number, totalBytes?: number, speedBps?: number) => void;
}

export interface HttpFetcherResult {
  storagePath: string;
  byteSize: number;
  sha256: string;
  mimeType: string | null;
}

/**
 * 默认从 URL 路径推扩展名；推不出再从 Content-Type 推；都不行用 'bin'。
 */
function pickExt(url: string, contentType: string | null, hint?: string): string {
  if (hint) return hint.replace(/^\./, '').toLowerCase();
  try {
    const u = new URL(url);
    const ext = path.posix.extname(u.pathname).slice(1).toLowerCase();
    if (ext) return ext;
  } catch {
    // ignore
  }
  if (contentType) {
    const ct = contentType.split(';')[0]?.trim().toLowerCase();
    const map: Record<string, string> = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/x-m4a': 'm4a',
      'audio/mp4': 'm4a',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/ogg': 'ogg',
      'audio/flac': 'flac',
      'audio/aac': 'aac',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'application/zip': 'zip',
      'application/pdf': 'pdf',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    if (ct && map[ct]) return map[ct];
  }
  return 'bin';
}

export async function downloadHttp(
  input: HttpFetcherInput,
  storage: FileStorage,
  ctx: HttpFetcherCtx,
): Promise<HttpFetcherResult> {
  // URL 校验：必须是合法 http/https
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.sourceUrl);
  } catch {
    throw new Error(`invalid URL: ${input.sourceUrl}`);
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error(`unsupported protocol: ${parsedUrl.protocol}`);
  }

  const stream = got.stream(input.sourceUrl, {
    timeout: { request: 600_000 }, // 10min total（大文件下载场景）
    retry: { limit: 2 },
    decompress: true,
    headers: {
      'user-agent': 'hatch-crawler/0.2 (+downloads)',
    },
  });

  // 抓 Content-Type / Content-Length 用来推扩展名 + 进度
  let contentType: string | null = null;
  let totalBytes: number | undefined;
  stream.on('response', (res) => {
    contentType = (res.headers['content-type'] as string | undefined) ?? null;
    const cl = res.headers['content-length'] as string | undefined;
    if (cl) totalBytes = Number(cl);
  });

  // 进度上报：got 的 downloadProgress 已经包含 percent / transferred / total
  let lastTime = Date.now();
  let lastBytes = 0;
  stream.on('downloadProgress', (p: { percent: number; transferred: number; total?: number }) => {
    const now = Date.now();
    const elapsed = (now - lastTime) / 1000;
    let speedBps: number | undefined;
    if (elapsed > 0.5) {
      speedBps = (p.transferred - lastBytes) / elapsed;
      lastTime = now;
      lastBytes = p.transferred;
    }
    ctx.onProgress(
      Math.round((p.percent || 0) * 100),
      p.transferred,
      p.total ?? totalBytes,
      speedBps,
    );
  });

  // AbortSignal → 中断 got
  const onAbort = () => {
    stream.destroy(new Error('aborted'));
  };
  if (ctx.signal.aborted) onAbort();
  else ctx.signal.addEventListener('abort', onAbort, { once: true });

  // 等 response 头到再决定扩展名（某些 URL 没扩展名要靠 Content-Type）
  await new Promise<void>((resolve, reject) => {
    stream.once('response', () => resolve());
    stream.once('error', reject);
  });

  const ext = pickExt(input.sourceUrl, contentType, input.extHint);
  const relPath = buildAttachmentPath({
    spider: input.spider,
    itemId: input.itemId,
    attachmentId: input.attachmentId,
    ext,
  });

  let put: PutResult;
  try {
    put = await storage.put(relPath, stream);
  } catch (err) {
    if (err instanceof HTTPError) {
      throw new Error(`HTTP ${String(err.response.statusCode)}: ${err.message}`);
    }
    throw err;
  } finally {
    ctx.signal.removeEventListener('abort', onAbort);
  }

  // 100% 收尾事件（got 的 downloadProgress 在 total unknown 时不会发 100%）
  ctx.onProgress(100, put.byteSize, put.byteSize);

  return {
    storagePath: relPath,
    byteSize: put.byteSize,
    sha256: put.sha256,
    mimeType: contentType,
  };
}
