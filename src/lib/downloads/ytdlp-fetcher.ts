import 'server-only';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { type FileStorage, buildAttachmentPath } from '@/lib/storage/files';

/**
 * RFC 0002 Phase C —— yt-dlp 下载 fetcher
 *
 * 用 spawn 调本机 yt-dlp（不走 shell）。下载到临时目录，再 stream 进 FileStorage。
 *
 * 策略：
 *  - 始终 prefer mp4+m4a → 合并 mp4，前端播放兼容性最好
 *  - --no-playlist 防止"一个频道 URL 误下载几百集"
 *  - --newline 让进度按行输出，便于流式解析
 *  - 进度解析：[download]   N.M% of ... at ...
 */

export interface YtdlpFetcherInput {
  attachmentId: string;
  spider: string;
  itemId: string;
  sourceUrl: string; // YouTube watch URL（或其它 yt-dlp 支持的 URL）
  /** true → 仅提取音频，输出 mp3；默认 false → 下载最佳画质视频 */
  audioOnly?: boolean;
}

export interface YtdlpFetcherCtx {
  signal: AbortSignal;
  onProgress: (pct: number, bytes: number, totalBytes?: number, speedBps?: number) => void;
}

export interface YtdlpFetcherResult {
  storagePath: string;
  byteSize: number;
  sha256: string;
  mimeType: string | null;
}

// 解析 [download]   12.3% of   23.45MiB at 1.23MiB/s ETA 00:18
const PROGRESS_RE =
  /\[download\]\s+([\d.]+)%\s+of\s+~?\s*([\d.]+)\s*([KMGTP]?i?B)\s+at\s+([\d.]+)\s*([KMGTP]?i?B)\/s/i;

const UNIT_TO_BYTES: Record<string, number> = {
  B: 1,
  KiB: 1024,
  MiB: 1024 ** 2,
  GiB: 1024 ** 3,
  TiB: 1024 ** 4,
  KB: 1000,
  MB: 1000 ** 2,
  GB: 1000 ** 3,
  TB: 1000 ** 4,
};

function unitBytes(value: number, unit: string): number {
  return value * (UNIT_TO_BYTES[unit] ?? 1);
}

export async function downloadYtdlp(
  input: YtdlpFetcherInput,
  storage: FileStorage,
  ctx: YtdlpFetcherCtx,
): Promise<YtdlpFetcherResult> {
  // URL 校验（仅允许 http/https；yt-dlp 内部还会校验是否为支持站点）
  let parsed: URL;
  try {
    parsed = new URL(input.sourceUrl);
  } catch {
    throw new Error(`invalid URL: ${input.sourceUrl}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`unsupported protocol: ${parsed.protocol}`);
  }

  // 临时目录
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), `hatch-ytdlp-${input.attachmentId}-`));

  const args = input.audioOnly
    ? [
        '-x', // 提取音频，丢弃视频流
        '--audio-format',
        'mp3',
        '--audio-quality',
        '0', // 最佳 VBR 质量
        '--no-playlist',
        '--no-warnings',
        '--newline',
        '-o',
        path.join(tmpDir, `${input.attachmentId}.%(ext)s`),
        input.sourceUrl,
      ]
    : [
        '-f',
        'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format',
        'mp4',
        '--no-playlist',
        '--no-warnings',
        '--newline', // 进度按换行刷新（默认是 \r 同行覆盖），便于流式解析
        '-o',
        path.join(tmpDir, `${input.attachmentId}.%(ext)s`),
        input.sourceUrl,
      ];

  // 进度节流：仅在 +1% 或 800ms 才回调（yt-dlp 自己刷新很快）
  let lastPct = -1;
  let lastTime = 0;

  await new Promise<void>((resolve, reject) => {
    const p = spawn('yt-dlp', args);

    let stderrTail = '';
    let stdoutBuf = '';
    p.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString();
      const lines = stdoutBuf.split('\n');
      stdoutBuf = lines.pop() ?? '';
      for (const line of lines) {
        const m = PROGRESS_RE.exec(line);
        if (!m) continue;
        const pct = Math.max(0, Math.min(99, Math.round(parseFloat(m[1]!))));
        const total = unitBytes(parseFloat(m[2]!), m[3]!);
        const speed = unitBytes(parseFloat(m[4]!), m[5]!);
        const bytes = Math.round(total * (pct / 100));
        const now = Date.now();
        if (pct !== lastPct || now - lastTime >= 800) {
          lastPct = pct;
          lastTime = now;
          ctx.onProgress(pct, bytes, total, speed);
        }
      }
    });
    p.stderr.on('data', (b: Buffer) => {
      stderrTail = (stderrTail + b.toString()).slice(-2048);
    });

    const onAbort = () => p.kill('SIGTERM');
    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener('abort', onAbort, { once: true });

    p.on('error', (err) => {
      ctx.signal.removeEventListener('abort', onAbort);
      reject(new Error(`spawn yt-dlp failed: ${err.message}`));
    });
    p.on('close', (code) => {
      ctx.signal.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new Error(`yt-dlp exited with code ${String(code)}: ${stderrTail.trim()}`));
    });
  });

  // 找到 yt-dlp 实际写出的文件（带它选定的扩展名）
  const files = await fsp.readdir(tmpDir);
  const finalName = files.find(
    (f) =>
      f.startsWith(input.attachmentId + '.') &&
      !f.endsWith('.part') &&
      !f.endsWith('.ytdl') &&
      !f.endsWith('.temp'),
  );
  if (!finalName) {
    await fsp.rm(tmpDir, { recursive: true, force: true });
    throw new Error('yt-dlp finished but produced no output file');
  }
  const ext = path.extname(finalName).slice(1).toLowerCase();
  const tmpPath = path.join(tmpDir, finalName);

  let storagePath: string;
  let put;
  try {
    storagePath = buildAttachmentPath({
      spider: input.spider,
      itemId: input.itemId,
      attachmentId: input.attachmentId,
      ext,
    });
    put = await storage.put(storagePath, createReadStream(tmpPath));
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }

  ctx.onProgress(100, put.byteSize, put.byteSize);

  // mime 由扩展名映射
  const mime =
    ext === 'mp4'
      ? 'video/mp4'
      : ext === 'webm'
        ? 'video/webm'
        : ext === 'mp3'
          ? 'audio/mpeg'
          : ext === 'm4a'
            ? 'audio/mp4'
            : null;

  return {
    storagePath,
    byteSize: put.byteSize,
    sha256: put.sha256,
    mimeType: mime,
  };
}
