import 'server-only';
import { SPIDER_REGISTRY, serializeParamSchema } from '@/lib/spider-registry';
import { failInternal, ok } from '@/lib/api/response';

/**
 * GET /api/spiders/registry
 *
 * 返回代码注册表里所有 Spider 的元数据。
 * 前端用于"新建 Spider"下拉框和参数表单自动渲染。
 */
export async function GET(): Promise<Response> {
  try {
    const entries = Object.entries(SPIDER_REGISTRY).map(([name, entry]) => ({
      name,
      platform: entry.platform ?? null,
      description: entry.description ?? null,
      paramSchema: serializeParamSchema(entry.paramSchema),
      excludeFromAutoDisable: entry.excludeFromAutoDisable ?? false,
    }));
    return ok(entries);
  } catch (err) {
    return failInternal(err);
  }
}
