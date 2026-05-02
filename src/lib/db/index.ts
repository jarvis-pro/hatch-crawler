/**
 * 数据库层公开 API（src/lib/db）
 */

import type {
  Event as PrismaEvent,
  ExtractJob as PrismaExtractJob,
  Item as PrismaItem,
  Run as PrismaRun,
  Setting as PrismaSetting,
  Spider as PrismaSpider,
} from '@prisma/client';

export type { WebhookDelivery } from '@prisma/client';

// 客户端
export { getDb, closeDb, type Db } from './client';
export {
  getBoss,
  closeBoss,
  QUEUE_CRAWL,
  QUEUE_EXTRACT,
  type CrawlJobData,
  type ExtractJobData,
} from './boss';

// 迁移
export { runMigrations, type MigrateResult } from './migrate';

// 内置 spider 注入（启动期幂等执行）
export { ensureBuiltinSpiders } from './ensure-builtin-spiders';

// repositories（按命名空间导出，避免方法名冲突）
export * as runRepo from './repositories/runs';
export * as itemRepo from './repositories/items';
export * as eventRepo from './repositories/events';
export * as settingRepo from './repositories/settings';
export { SETTINGS_KEYS, type SettingsKey } from './repositories/settings';
export * as spiderRepo from './repositories/spiders';
export * as accountRepo from './repositories/accounts';
export * as extractJobRepo from './repositories/extract-jobs';

// 枚举：Prisma 把它们生成成 const object，可以同时当类型和值用
export { RunStatus, EventLevel } from '@prisma/client';

/**
 * 业务实体类型。
 *
 * Prisma 把 jsonb 列推断成 `JsonValue`；这里把已知形状的 jsonb 收紧成业务类型，
 * 让 repository / 调用方少写一道 cast。写入时这些字段会被 Prisma 接受为 InputJson。
 */
export type Spider = Omit<PrismaSpider, 'startUrls' | 'allowedHosts' | 'defaultParams'> & {
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
  /** RFC 0003：任务类型派生标记 */
  taskKind: TaskKind;
};

export type Run = Omit<PrismaRun, 'overrides'> & {
  /**
   * FK 引用 spiders.id（nullable：历史数据可能无对应 spider）。
   * prisma generate 运行后由 PrismaRun 自动提供；这里显式声明保证 generate 前也能编译。
   */
  spiderId: string | null;
  overrides: Record<string, unknown> | null;
  /** RFC 0003：同步自 spider.task_kind，查询时免 JOIN */
  taskKind: TaskKind | null;
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
  // RFC 0003：来源 chip 过滤用
  triggerKind: string | null;
  taskId: string | null;
  /**
   * 快取链路 FK：当 item 来自 /api/extract 时回填。
   * prisma generate 运行后由 PrismaItem 自动提供；
   * 这里显式声明保证 generate 前也能编译。
   */
  extractJobId: string | null;
};

export type Setting = PrismaSetting;

/**
 * 快取（按链接抓取）任务状态。
 *  - running：入队中或处理中（已有 worker 在跑）
 *  - completed：所有 supported URL 都已处理（succeeded + failed = total）
 *
 * 暂不引入显式 'failed' 状态——单条 URL 失败由 results 内部记录，
 * 整体 job 即使全部失败也按 completed 收尾。
 */
export type ExtractJobStatus = 'running' | 'completed';

/**
 * results jsonb 中单条 URL 的形状。
 * key = canonicalUrl（与 items.url 对齐，便于跨表 JOIN）。
 */
export interface ExtractUrlResult {
  /** 用户原始输入（标准化前），仅供 UI 回显 */
  originalUrl: string;
  /** 命中的平台（YouTube / Bilibili 等），来自 inspect */
  platform: string;
  status: 'pending' | 'succeeded' | 'failed';
  errorCode?: string;
  errorMessage?: string;
  /** 写入成功时的 items.id（UUID 字符串） */
  itemId?: string;
  finishedAt?: string;
}

export type ExtractJob = Omit<PrismaExtractJob, 'submittedUrls' | 'results' | 'status'> & {
  submittedUrls: string[];
  results: Record<string, ExtractUrlResult>;
  status: ExtractJobStatus;
};

/**
 * 任务类型：三分心智模型（RFC 0003）
 *  - subscription：带 cron、持续运行
 *  - batch：手动触发、一次性大量抓取
 *  - extract：URL 驱动的快取
 */
export type TaskKind = 'subscription' | 'batch' | 'extract';

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
  /** RFC 0003：subscription / batch / extract；null = 自动推断 */
  taskKind?: TaskKind | null;
};

export type NewRun = {
  /** spiders.id UUID，作为 FK */
  spiderId: string;
  /** 冗余存储 spider.name（用户显示名），便于查询与展示 */
  spiderName: string;
  triggerType: string;
  overrides?: Record<string, unknown>;
  /** RFC 0003：同步自 spider.task_kind */
  taskKind?: TaskKind | null;
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
  // RFC 0003
  triggerKind?: string | null;
  taskId?: string | null;
  /** 快取链路 FK，与 runId 互斥使用 */
  extractJobId?: string | null;
};

export type NewExtractJob = {
  /** 用户原始提交的 URL 列表（包括 invalid / unsupported），仅作审计 */
  submittedUrls: string[];
  /**
   * 已 inspect 通过的 URL 状态 map：
   * key = canonicalUrl，value = { originalUrl, platform, status='pending' }
   */
  results: Record<string, ExtractUrlResult>;
};
