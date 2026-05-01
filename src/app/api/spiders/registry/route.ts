import 'server-only';
import { SPIDER_REGISTRY } from '@/lib/spider-registry';
import { failInternal, ok } from '@/lib/api/response';

/**
 * GET /api/spiders/registry
 *
 * 返回代码注册表里所有 Spider 的元数据（name + platform）。
 * 前端用于"新建 Spider"下拉框，无需了解 SPIDER_REGISTRY 的内部结构。
 */
export async function GET(): Promise<Response> {
  try {
    const entries = Object.entries(SPIDER_REGISTRY).map(([name, entry]) => ({
      name,
      platform: entry.platform ?? null,
    }));
    return ok(entries);
  } catch (err) {
    return failInternal(err);
  }
}
