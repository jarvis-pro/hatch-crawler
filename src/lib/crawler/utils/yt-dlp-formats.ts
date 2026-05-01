import { spawn } from 'node:child_process';

/** 单个视频格式条目 */
export interface VideoFormatEntry {
  /** 视频高度（px），如 1080 */
  height: number;
  /**
   * 预估总下载大小（字节，视频流 + 最优音频流之和）。
   * 取自 yt-dlp 的 filesize / filesize_approx，仅供参考。
   */
  size?: number;
}

/**
 * 视频可用格式信息，由 yt-dlp --dump-json 解析而来。
 * 存储于 item.payload.videoFormats。
 */
export interface VideoFormats {
  /** 可用视频格式，按分辨率降序排列 */
  formats: VideoFormatEntry[];
  /** 是否有独立音频流（可提取为 mp3） */
  hasAudio: boolean;
  /** 最优音频流预估大小（字节，仅供参考） */
  audioSize?: number;
}

/**
 * 调用 yt-dlp --dump-json 解析指定 URL 的可用格式。
 *
 * - 失败（yt-dlp 未安装、网络错误、私有视频等）时静默返回 null，不抛错。
 * - 超时默认 60 秒。
 */
export async function fetchVideoFormats(
  url: string,
  timeoutMs = 60_000,
): Promise<VideoFormats | null> {
  return new Promise((resolve) => {
    let stdout = '';
    let timedOut = false;

    let p: ReturnType<typeof spawn>;
    try {
      p = spawn(
        'yt-dlp',
        ['--dump-json', '--no-warnings', '--no-playlist', '--skip-download', url],
        { stdio: 'pipe' },
      );
    } catch {
      resolve(null);
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      p.kill('SIGTERM');
    }, timeoutMs);

    p.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    p.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });

    p.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut || code !== 0 || !stdout.trim()) {
        resolve(null);
        return;
      }

      try {
        const info = JSON.parse(stdout) as Record<string, unknown>;
        resolve(parseFormats(info));
      } catch {
        resolve(null);
      }
    });
  });
}

// ── 内部解析 ──────────────────────────────────────────────────────────────────

interface YtdlpFormat {
  vcodec?: string;
  acodec?: string;
  height?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
}

function parseFormats(info: Record<string, unknown>): VideoFormats {
  const rawFormats = (info.formats ?? []) as YtdlpFormat[];

  const heightSet = new Set<number>();
  // 同一高度可能有多个 codec 的 format，保留最大 filesize
  const videoSizeByHeight = new Map<number, number>();
  let hasAudio = false;
  let bestAudioSize: number | undefined;

  for (const fmt of rawFormats) {
    const hasVideo = fmt.vcodec && fmt.vcodec !== 'none';
    const hasAudioTrack = fmt.acodec && fmt.acodec !== 'none';
    const size = fmt.filesize ?? fmt.filesize_approx ?? undefined;

    if (hasAudioTrack) {
      hasAudio = true;
      if (size != null && (bestAudioSize === undefined || size > bestAudioSize)) {
        bestAudioSize = size;
      }
    }

    if (hasVideo && typeof fmt.height === 'number' && fmt.height > 0) {
      heightSet.add(fmt.height);
      if (size != null) {
        const existing = videoSizeByHeight.get(fmt.height);
        if (existing === undefined || size > existing) {
          videoSizeByHeight.set(fmt.height, size);
        }
      }
    }
  }

  // 如果 formats 为空（部分站点不返回 formats 数组，但顶层有 height/vcodec）
  if (heightSet.size === 0 && typeof info.height === 'number' && info.height > 0) {
    heightSet.add(info.height as number);
  }
  if (!hasAudio && info.acodec && info.acodec !== 'none') {
    hasAudio = true;
  }

  const sortedHeights = [...heightSet].sort((a, b) => b - a);

  const formats: VideoFormatEntry[] = sortedHeights.map((h) => {
    const videoSize = videoSizeByHeight.get(h);
    // 总大小 = 视频流 + 音频流（两者都有时）
    const size =
      videoSize != null && bestAudioSize != null
        ? videoSize + bestAudioSize
        : (videoSize ?? bestAudioSize);
    return size != null ? { height: h, size } : { height: h };
  });

  return {
    formats,
    hasAudio,
    ...(bestAudioSize != null ? { audioSize: bestAudioSize } : {}),
  };
}
