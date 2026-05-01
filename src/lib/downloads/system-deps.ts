import 'server-only';
import { spawn } from 'node:child_process';

/**
 * RFC 0002 — 检测下载/转码所需的本机依赖（ffmpeg / yt-dlp）。
 *
 * 看板顶部 banner / API health 端点用这个判断要不要提示用户装。
 * 结果在进程内 cache 5 分钟，避免每次请求都 spawn 子进程。
 */

export interface SystemDepStatus {
  ok: boolean;
  version?: string;
  /** 缺失时给一段安装提示 */
  installHint?: string;
}

export interface SystemDepsHealth {
  ffmpeg: SystemDepStatus;
  ytdlp: SystemDepStatus;
  checkedAt: number;
}

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_KEY = '__hatchSysDepsCache';
type Holder = { [CACHE_KEY]?: SystemDepsHealth };

function probe(cmd: string, args: string[]): Promise<SystemDepStatus> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args);
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
      // 取第一行的版本号（ffmpeg / yt-dlp 都把版本写在 stdout 第一行）
      const version = out.split('\n')[0]?.trim();
      resolve({ ok: true, version });
    });
  });
}

export async function checkSystemDeps(): Promise<SystemDepsHealth> {
  const holder = globalThis as unknown as Holder;
  const cached = holder[CACHE_KEY];
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) return cached;

  const [ffmpeg, ytdlp] = await Promise.all([
    probe('ffmpeg', ['-version']),
    probe('yt-dlp', ['--version']),
  ]);

  const result: SystemDepsHealth = {
    ffmpeg: ffmpeg.ok
      ? ffmpeg
      : {
          ok: false,
          installHint:
            '需要 ffmpeg 才能转码视频→音频。macOS：`brew install ffmpeg`；Docker：镜像已内置。',
        },
    ytdlp: ytdlp.ok
      ? ytdlp
      : {
          ok: false,
          installHint:
            '需要 yt-dlp 才能下载 YouTube 视频。macOS：`brew install yt-dlp`；Docker：镜像已内置。',
        },
    checkedAt: Date.now(),
  };
  holder[CACHE_KEY] = result;
  return result;
}
