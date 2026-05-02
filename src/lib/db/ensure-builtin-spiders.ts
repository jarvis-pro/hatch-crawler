import 'server-only';
import type { Db } from './client';
import * as spiderRepo from './repositories/spiders';

/**
 * 确保系统内置 spider 在 spiders 表中存在。
 *
 * 当前 BUILTINS 为空（url-extractor 已下线，extract 链路改走独立 extract_jobs 表）。
 * 保留模块与调用点，便于未来再加内置 spider 时直接往 BUILTINS push 一条即可。
 *
 * 设计原则：
 *  - 用 spiderRepo.getByType 检查存在性，而不是写死 UUID 常量。
 *  - 幂等：已存在则跳过，不更新已有行（避免覆盖用户手动改过的 enabled / 描述）。
 */

interface BuiltinSpiderSpec {
  type: string;
  name: string;
  description: string;
  platform?: string;
}

const BUILTINS: BuiltinSpiderSpec[] = [];

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
