import 'server-only';
import { failInternal, ok } from '@/lib/api/response';
import { checkSystemDeps } from '@/lib/downloads/system-deps';

/** GET /api/system/health — 看板顶部 banner 用，检查 ffmpeg / yt-dlp 是否可用 */
export async function GET(): Promise<Response> {
  try {
    const deps = await checkSystemDeps();
    return ok(deps);
  } catch (err) {
    return failInternal(err);
  }
}
