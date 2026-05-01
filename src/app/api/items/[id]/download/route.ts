import 'server-only';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import got from 'got';
import { itemRepo, getDb } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, failValidation } from '@/lib/api/response';
import { z } from 'zod';
import { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Readable } from 'node:stream';

interface Ctx {
  params: Promise<{ id: string }>;
}

const querySchema = z.object({
  url: z.string().url(),
  fetcher: z.enum(['http', 'ytdlp']).default('http'),
});

/**
 * GET /api/items/:id/download
 *
 * 流式代理下载，触发浏览器原生下载进度条。
 *
 * Query 参数：
 *   url     - 源文件地址（必填）
 *   fetcher - 'http'（默认）或 'ytdlp'（YouTube 等需要 yt-dlp 的站点）
 *
 * - http 模式：直接 pipe 源 URL 响应到浏览器，无本地落盘。
 * - ytdlp 模式：spawn yt-dlp 下载到临时文件，完成后流式返回，结束后删除临时文件。
 *   断开连接（request.signal abort）时自动 kill yt-dlp 进程。
 */
export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  try {
    const { id } = await params;
    const num = Number(id);
    if (!Number.isFinite(num)) return fail('NOT_FOUND', `bad item id: ${id}`);

    const db = getDb(env.databaseUrl);
    const item = await itemRepo.getById(db, num);
    if (!item) return fail('NOT_FOUND', `item not found: ${id}`);

    const rawQuery = Object.fromEntries(new URL(req.url).searchParams.entries());
    const parsed = querySchema.safeParse(rawQuery);
    if (!parsed.success) return failValidation(parsed.error);

    const { url: sourceUrl, fetcher } = parsed.data;

    if (fetcher === 'ytdlp') {
      return streamYtdlp(sourceUrl, req.signal);
    }
    return streamHttp(sourceUrl, req.signal);
  } catch (err) {
    return failInternal(err);
  }
}

/** HTTP 直链：got stream → browser response */
function streamHttp(sourceUrl: string, signal: AbortSignal): Response {
  const stream = got.stream(sourceUrl, {
    timeout: { request: 600_000 },
    retry: { limit: 1 },
    headers: { 'user-agent': 'hatch-crawler/0.2 (+downloads)' },
  });

  // 中断时销毁 got stream
  const onAbort = () => stream.destroy();
  if (signal.aborted) {
    onAbort();
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  // 推断文件名
  const filename = inferFilename(sourceUrl);

  // 等响应头到再决定 Content-Type 和 Content-Length
  let contentType = 'application/octet-stream';
  let contentLength: string | undefined;
  stream.on('response', (res) => {
    const ct = res.headers['content-type'] as string | undefined;
    if (ct) contentType = ct.split(';')[0]?.trim() ?? contentType;
    const cl = res.headers['content-length'] as string | undefined;
    if (cl) contentLength = cl;
    signal.removeEventListener('abort', onAbort);
  });

  const webStream = NodeReadableStream.from(
    stream as unknown as Readable,
  ) as unknown as ReadableStream;

  const headers = new Headers({
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  });
  if (contentLength) headers.set('Content-Length', contentLength);

  return new Response(webStream, { headers });
}

/** yt-dlp：下载到临时文件，完成后流式返回给浏览器 */
async function streamYtdlp(sourceUrl: string, signal: AbortSignal): Promise<Response> {
  const tmpId = Math.random().toString(36).slice(2);
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), `hatch-ytdlp-${tmpId}-`));

  const args = [
    '-f',
    'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
    '--merge-output-format',
    'mp4',
    '--no-playlist',
    '--no-warnings',
    '-o',
    path.join(tmpDir, `out.%(ext)s`),
    sourceUrl,
  ];

  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderrTail = '';

      p.stderr?.on('data', (b: Buffer) => {
        stderrTail = (stderrTail + b.toString()).slice(-2048);
      });

      const onAbort = () => p.kill('SIGTERM');
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      p.on('error', (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(new Error(`spawn yt-dlp failed: ${err.message}`));
      });
      p.on('close', (code) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(new Error('aborted'));
        else if (code === 0) resolve();
        else reject(new Error(`yt-dlp exited ${String(code)}: ${stderrTail.trim()}`));
      });
    });
  } catch (err) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  // 找到输出文件
  const files = await fsp.readdir(tmpDir);
  const outFile = files.find(
    (f) => f.startsWith('out.') && !f.endsWith('.part') && !f.endsWith('.ytdl'),
  );
  if (!outFile) {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw new Error('yt-dlp 未产生输出文件');
  }

  const outPath = path.join(tmpDir, outFile);
  const ext = path.extname(outFile).slice(1).toLowerCase();
  const stat = await fsp.stat(outPath);

  const mimeMap: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    mkv: 'video/x-matroska',
  };
  const contentType = mimeMap[ext] ?? 'application/octet-stream';

  const fileStream = createReadStream(outPath);
  // 文件流结束后删除临时目录
  fileStream.on('close', () => {
    void fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  const webStream = NodeReadableStream.from(
    fileStream as unknown as Readable,
  ) as unknown as ReadableStream;

  return new Response(webStream, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="video.${ext}"`,
      'Content-Length': String(stat.size),
      'Cache-Control': 'no-store',
    },
  });
}

function inferFilename(url: string): string {
  try {
    const u = new URL(url);
    const base = path.posix.basename(u.pathname);
    if (base && base !== '/') return base;
  } catch {
    // ignore
  }
  return 'download';
}
