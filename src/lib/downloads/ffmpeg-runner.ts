import 'server-only';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';

/**
 * RFC 0002 Phase B —— ffmpeg 转码包装
 *
 * 通过 spawn 调用本机 `ffmpeg` 与 `ffprobe`（不走 shell，避免命令注入）。
 *
 * 关键点：
 *  - 用 `-progress pipe:1` 收结构化进度（key=value 行），不解析 stderr 的人类可读输出
 *  - 进度百分比 = out_time_us / total_duration_us，需要先 ffprobe 拿源时长
 *  - 完成后单独 hash + stat 出 sha256 / byteSize（避免在 ffmpeg 输出流中算）
 */

export interface FfmpegRunnerCtx {
  signal: AbortSignal;
  onProgress: (pct: number) => void;
}

export interface FfmpegResult {
  byteSize: number;
  sha256: string;
}

/** 检测系统是否装了 ffmpeg & ffprobe；启动检测用。 */
export async function checkFfmpegAvailable(): Promise<{ ok: boolean; version?: string }> {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-version']);
    let out = '';
    p.stdout.on('data', (b: Buffer) => {
      out += b.toString();
    });
    p.on('error', () => resolve({ ok: false }));
    p.on('close', (code) => {
      if (code !== 0) {
        resolve({ ok: false });
        return;
      }
      const v = /ffmpeg version (\S+)/.exec(out)?.[1];
      resolve({ ok: true, version: v });
    });
  });
}

async function probeDurationSec(srcAbs: string): Promise<number | null> {
  return new Promise((resolve) => {
    const p = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nw=1:nk=1',
      srcAbs,
    ]);
    let out = '';
    p.stdout.on('data', (b: Buffer) => {
      out += b.toString();
    });
    p.on('error', () => resolve(null));
    p.on('close', () => {
      const n = parseFloat(out.trim());
      resolve(Number.isFinite(n) ? n : null);
    });
  });
}

/**
 * 视频 → mp3 音频。
 *
 * 用 -vn 去视频流；libmp3lame 编码；-q:a 4 是 VBR 标准质量（约 165kbps）。
 */
export async function videoToMp3(
  srcAbs: string,
  dstAbs: string,
  ctx: FfmpegRunnerCtx,
): Promise<FfmpegResult> {
  await fsp.mkdir(dstAbs.substring(0, dstAbs.lastIndexOf('/')), { recursive: true });

  const durationSec = await probeDurationSec(srcAbs);

  const args = [
    '-y', // 覆盖输出
    '-i',
    srcAbs,
    '-vn',
    '-acodec',
    'libmp3lame',
    '-q:a',
    '4',
    '-progress',
    'pipe:1',
    '-nostats',
    '-loglevel',
    'error',
    dstAbs,
  ];

  await new Promise<void>((resolve, reject) => {
    const p = spawn('ffmpeg', args);

    let buf = '';
    let stderrTail = '';
    p.stdout.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const k = line.slice(0, eq).trim();
        const v = line.slice(eq + 1).trim();
        if (k === 'out_time_us' && durationSec && durationSec > 0) {
          const sec = Number(v) / 1_000_000;
          if (Number.isFinite(sec)) {
            const pct = Math.max(0, Math.min(99, Math.round((sec / durationSec) * 100)));
            ctx.onProgress(pct);
          }
        } else if (k === 'progress' && v === 'end') {
          ctx.onProgress(100);
        }
      }
    });
    p.stderr.on('data', (b: Buffer) => {
      // 留尾部 1KB 用于报错
      stderrTail = (stderrTail + b.toString()).slice(-1024);
    });

    const onAbort = () => p.kill('SIGTERM');
    if (ctx.signal.aborted) onAbort();
    else ctx.signal.addEventListener('abort', onAbort, { once: true });

    p.on('error', (err) => {
      ctx.signal.removeEventListener('abort', onAbort);
      reject(new Error(`spawn ffmpeg failed: ${err.message}`));
    });
    p.on('close', (code) => {
      ctx.signal.removeEventListener('abort', onAbort);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${String(code)}: ${stderrTail.trim()}`));
    });
  });

  // 算 sha256 + size
  const stat = await fsp.stat(dstAbs);
  const sha256 = await new Promise<string>((resolve, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(dstAbs);
    s.on('data', (c: Buffer | string) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
    s.on('error', reject);
  });

  return { byteSize: stat.size, sha256 };
}
