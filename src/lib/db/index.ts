/**
 * 数据库层公开 API（src/lib/db）
 */

import type {
  Event as PrismaEvent,
  Item as PrismaItem,
  Run as PrismaRun,
  Setting as PrismaSetting,
  Spider as PrismaSpider,
} from '@prisma/client';

// 客户端
export { getDb, closeDb, type Db } from './client';
export { getBoss, closeBoss, QUEUE_CRAWL, type CrawlJobData } from './boss';

// 迁移
export { runMigrations, type MigrateResult } from './migrate';

// 内置 spider 注入（启动期幂等执行）
export { ensureBuiltinSpiders } from './ensure-builtin-spiders';

// repositories（按命名空间导出，避免方法名冲突）
export * as runRepo from './repositories/runs';
export * as itemRepo from './repositories/items';
export * as eventRepo from './repositories/events';
export * as settingRepo from './repositories/settings';
export * as spiderRepo from './repositories/spiders';
export * as accountRepo from './repositories/accounts';

// 枚举：Prisma 把它们生成成 const object，可以同时当类型和值用
export { RunStatus, EventLevel } from '@prisma/client';

/**
 * 业务实体类型。
 *
 * Prisma 把 jsonb 列推断成 `JsonValue`；这里把已知形状的 jsonb 收紧成业务类型，
 * 让 repository / 调用方少写一道 cast。写入时这些字段会被 Prisma 接受为 InputJson。
 */
export type Spider = Omit<
  PrismaSpider,
  'startUrls' | 'allowedHosts' | 'defaultParams' | 'displayName'
> & {
  /**
   * UUID 主键。prisma generate 运行后由 PrismaSpider 自动提供；
   * 这里显式声明保证 generate 前也能编译。
   */
  id: string;
  /**
   * 注册表类型键（如 "youtube-search"）。prisma generate 运行后由 PrismaSpider 提供；
   * 这里显式声明保证 generate 前也能编译。
   */
  type: string;
  startUrls: string[];
  allowedHosts: string[];
  defaultParams: Record<string, unknown>;
};

export type Run = Omit<PrismaRun, 'overrides'> & {
  /**
   * FK 引用 spiders.id（nullable：历史数据可能无对应 spider）。
   * prisma generate 运行后由 PrismaRun 自动提供；这里显式声明保证 generate 前也能编译。
   */
  spiderId: string | null;
  overrides: Record<string, unknown> | null;
};

export type Event = Omit<PrismaEvent, 'payload'> & {
  payload: Record<string, unknown> | null;
};

export type Item = Omit<PrismaItem, 'payload'> & {
  payload: Record<string, unknown>;
  // Phase 5 列（Prisma 已映射，这里收紧类型）
  platform: string | null;
  kind: string | null;
  sourceId: string | null;
};

export type Setting = PrismaSetting;

// repository create-input 速记
export type NewSpider = {
  /** 注册表类型键（如 "youtube-search"），worker 靠此反查实现类 */
  type: string;
  /** 用户自定义显示名称（中文友好），可重复 */
  name: string;
  description?: string | null;
  startUrls: string[];
  allowedHosts?: string[];
  maxDepth?: number;
  concurrency?: number;
  perHostIntervalMs?: number;
  enabled?: boolean;
  cronSchedule?: string | null;
  platform?: string | null;
  defaultParams?: Record<string, unknown>;
};

export type NewRun = {
  /** spiders.id UUID，作为 FK */
  spiderId: string;
  /** 冗余存储 spider.name（注册表类型键），便于查询与展示 */
  spiderName: string;
  triggerType: string;
  overrides?: Record<string, unknown>;
};

export type NewEvent = {
  runId: string;
  level: import('@prisma/client').EventLevel;
  type: string;
  message?: string | null;
  payload?: Record<string, unknown>;
};

export type NewItem = {
  runId?: string | null;
  spider: string;
  type: string;
  url: string;
  urlHash: string;
  contentHash: string;
  payload: Record<string, unknown>;
  // Phase 5
  platform?: string | null;
  kind?: string | null;
  sourceId?: string | null;
};
