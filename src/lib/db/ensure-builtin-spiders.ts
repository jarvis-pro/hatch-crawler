import 'server-only';
import type { Db } from './client';
import * as spiderRepo from './repositories/spiders';

/**
 * 确保系统内置 spider 在 spiders 表中存在。
 *
 * 内置 spider = "代码里就有、不需要用户手工创建"的 spider。
 * 例如 url-extractor 是给 /api/extract 用的执行壳，
 * 用户从来不会去 /spiders 页面手动建一条它，但运行时必须有 id 可引用。
 *
 * 设计选择：
 *  - 用 spiderRepo.getByType 检查存在性，而不是写死 UUID 常量。
 *    这样删表重建后会自动恢复，迁移到其他环境也无需同步常量。
 *  - 幂等：已存在则跳过，不更新已有行（避免覆盖用户手动改过的 enabled / 描述）。
 *  - 仅在 instrumentation.ts 启动钩子里调一次，开销可以忽略。
 */

interface BuiltinSpiderSpec {
  type: string;
  name: string;
  description: string;
  platform?: string;
}

const BUILTINS: BuiltinSpiderSpec[] = [
  {
    type: 'url-extractor',
    name: 'URL 提取器',
    description:
      '按用户传入的 URL 列表逐条提取视频元数据（YouTube 等）。/api/extract 端点的执行壳。',
  },
];

export async function ensureBuiltinSpiders(db: Db): Promise<void> {
  for (const spec of BUILTINS) {
    const existing = await spiderRepo.getByType(db, spec.type);
    if (existing) continue;

    await spiderRepo.create(db, {
      type: spec.type,
      name: spec.name,
      description: spec.description,
      startUrls: [],
      allowedHosts: [],
      enabled: true,
      cronSchedule: null,
      platform: spec.platform ?? null,
      defaultParams: {},
    });
  }
}
