import { PrismaClient } from '@prisma/client';
import PgBoss from 'pg-boss';

/**
 * 迁移函数：保证业务表 + pg-boss 队列表都就绪。
 *
 * 设计取舍：
 *  - 不用 `prisma migrate deploy` 那一套（生产路径需要把 prisma/migrations
 *    打进镜像 + 跑 CLI），项目处于早期阶段，幂等内联 SQL 更轻
 *  - 直接用 CREATE TABLE IF NOT EXISTS 内联 SQL，幂等可重入
 *  - schema 与 prisma/schema.prisma 保持一致；改了 schema.prisma 后
 *    把对应 DDL 同步到这里（或者切到 prisma migrate 再说）
 *
 * 调用方：
 *  - src/instrumentation.ts 启动时调一次
 *  - scripts/db-migrate.ts 也调它（手动迁移用）
 */

/**
 * 各条 DDL 独立存放，逐条传给 $executeRawUnsafe。
 * 原因：Prisma 的 $executeRawUnsafe 底层走 prepared statement，
 * PostgreSQL 不允许在同一个 prepared statement 里放多条命令（code 42601）。
 */
const BUSINESS_SCHEMA_STMTS: string[] = [
  // ── 枚举 ────────────────────────────────────────────────
  `DO $$ BEGIN
  CREATE TYPE "run_status" AS ENUM ('queued', 'running', 'completed', 'failed', 'stopped');
EXCEPTION WHEN duplicate_object THEN null;
END $$`,

  `DO $$ BEGIN
  CREATE TYPE "event_level" AS ENUM ('debug', 'info', 'warn', 'error');
EXCEPTION WHEN duplicate_object THEN null;
END $$`,

  // ── spiders ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "spiders" (
  "name" varchar(64) PRIMARY KEY,
  "display_name" varchar(128) NOT NULL,
  "description" text,
  "start_urls" jsonb NOT NULL,
  "allowed_hosts" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "max_depth" integer NOT NULL DEFAULT 2,
  "concurrency" integer NOT NULL DEFAULT 4,
  "per_host_interval_ms" integer NOT NULL DEFAULT 500,
  "enabled" boolean NOT NULL DEFAULT true,
  "cron_schedule" varchar(64),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
)`,

  // ── runs ────────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "spider_name" varchar(64) NOT NULL REFERENCES "spiders"("name") ON DELETE CASCADE,
  "status" "run_status" NOT NULL DEFAULT 'queued',
  "trigger_type" varchar(16) NOT NULL,
  "overrides" jsonb DEFAULT '{}'::jsonb,
  "fetched" integer NOT NULL DEFAULT 0,
  "emitted" integer NOT NULL DEFAULT 0,
  "new_items" integer NOT NULL DEFAULT 0,
  "errors" integer NOT NULL DEFAULT 0,
  "started_at" timestamp,
  "finished_at" timestamp,
  "error_message" text,
  "created_at" timestamp NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS "idx_runs_status" ON "runs" ("status")`,
  `CREATE INDEX IF NOT EXISTS "idx_runs_spider" ON "runs" ("spider_name", "created_at")`,

  // ── events ──────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "events" (
  "id" serial PRIMARY KEY,
  "run_id" uuid NOT NULL REFERENCES "runs"("id") ON DELETE CASCADE,
  "level" "event_level" NOT NULL,
  "type" varchar(32) NOT NULL,
  "message" text,
  "payload" jsonb DEFAULT '{}'::jsonb,
  "occurred_at" timestamp NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS "idx_events_run_time" ON "events" ("run_id", "occurred_at")`,

  // ── items ───────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "items" (
  "id" serial PRIMARY KEY,
  "run_id" uuid REFERENCES "runs"("id") ON DELETE SET NULL,
  "spider" varchar(64) NOT NULL,
  "type" varchar(32) NOT NULL,
  "url" text NOT NULL,
  "url_hash" char(40) NOT NULL,
  "content_hash" char(40) NOT NULL,
  "payload" jsonb NOT NULL,
  "fetched_at" timestamp NOT NULL DEFAULT now()
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "uniq_items_spider_url_content" ON "items" ("spider", "url_hash", "content_hash")`,
  `CREATE INDEX IF NOT EXISTS "idx_items_spider_type" ON "items" ("spider", "type")`,
  `CREATE INDEX IF NOT EXISTS "idx_items_fetched_at" ON "items" ("fetched_at")`,

  // ── visited ─────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "visited" (
  "spider" varchar(64) NOT NULL,
  "url_hash" char(40) NOT NULL,
  "url" text NOT NULL,
  "visited_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("spider", "url_hash")
)`,

  // ── settings ────────────────────────────────────────────
  `CREATE TABLE IF NOT EXISTS "settings" (
  "key" varchar(64) PRIMARY KEY,
  "value" jsonb NOT NULL,
  "updated_at" timestamp NOT NULL DEFAULT now()
)`,

  // ── Phase 5：多平台扩展 ALTER TABLE（幂等）────────────────────

  // items 加三列
  `ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "platform" varchar(32)`,
  `ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "kind" varchar(16)`,
  `ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "source_id" varchar(128)`,

  // items 新增索引
  `CREATE INDEX IF NOT EXISTS "idx_items_kind" ON "items" ("kind") WHERE "kind" IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS "idx_items_platform" ON "items" ("platform") WHERE "platform" IS NOT NULL`,
  // (platform, source_id) 唯一，仅对双非 null 行生效（幂等）
  `CREATE UNIQUE INDEX IF NOT EXISTS "uniq_items_platform_source" ON "items" ("platform", "source_id") WHERE "platform" IS NOT NULL AND "source_id" IS NOT NULL`,

  // spiders 加两列
  `ALTER TABLE "spiders" ADD COLUMN IF NOT EXISTS "platform" varchar(32)`,
  `ALTER TABLE "spiders" ADD COLUMN IF NOT EXISTS "emits_kinds" jsonb NOT NULL DEFAULT '[]'::jsonb`,

  // ── Phase A：Spider defaultParams 列 ────────────────────────────
  `ALTER TABLE "spiders" ADD COLUMN IF NOT EXISTS "default_params" jsonb NOT NULL DEFAULT '{}'`,

  // ── Phase 6：accounts 表（凭据管理）──────────────────────────────

  `DO $$ BEGIN
  CREATE TYPE "account_kind" AS ENUM ('cookie', 'oauth', 'apikey', 'session');
EXCEPTION WHEN duplicate_object THEN null;
END $$`,

  `DO $$ BEGIN
  CREATE TYPE "account_status" AS ENUM ('active', 'expired', 'banned', 'disabled');
EXCEPTION WHEN duplicate_object THEN null;
END $$`,

  `CREATE TABLE IF NOT EXISTS "accounts" (
  "id" serial PRIMARY KEY,
  "platform" varchar(32) NOT NULL,
  "label" varchar(64) NOT NULL,
  "kind" "account_kind" NOT NULL,
  "payload_enc" text NOT NULL,
  "expires_at" timestamp,
  "status" "account_status" NOT NULL DEFAULT 'active',
  "last_used_at" timestamp,
  "failure_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
)`,
  `CREATE INDEX IF NOT EXISTS "idx_accounts_platform_status" ON "accounts" ("platform", "status")`,

  // ── Phase D：accounts 健康度列 ────────────────────────────────────────────
  `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "last_tested_at" timestamp`,
  `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "last_test_ok" boolean`,
  `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "quota_used_today" integer NOT NULL DEFAULT 0`,
  `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "quota_reset_at" date NOT NULL DEFAULT CURRENT_DATE`,

  // ── Phase X：Spider 连续失败计数 ─────────────────────────────────────────
  `ALTER TABLE "spiders" ADD COLUMN IF NOT EXISTS "consecutive_failures" integer NOT NULL DEFAULT 0`,

  // ── Spider 多实例支持：新增 spider_type 列，将注册表类型键与用户自定义名分离 ──
  // spider_type 存放注册表中的引擎类型键（如 youtube-channel-videos）；
  // name 保持为用户自定义的唯一标识符（PK）。
  // 存量记录回填：spider_type = name（原来两者相同）。
  `ALTER TABLE "spiders" ADD COLUMN IF NOT EXISTS "spider_type" varchar(64) NOT NULL DEFAULT ''`,
  // 回填：仅对 spider_type 仍为空字符串（即刚加列或历史数据）的行执行，幂等
  `UPDATE "spiders" SET "spider_type" = "name" WHERE "spider_type" = ''`,

  // ── Spider UUID 主键重构 ──────────────────────────────────────────────────────
  // 旧设计：spiders.name 为 PK，spiderType 存注册表键。
  // 新设计：spiders.id UUID 为 PK，name 即为注册表键（允许同类型多实例）。

  // 1. spiders 加 id 列（带 DEFAULT，添加时对所有存量行自动赋 UUID）
  `ALTER TABLE "spiders" ADD COLUMN IF NOT EXISTS "id" uuid DEFAULT gen_random_uuid()`,

  // 2. runs 加 spider_id 列
  `ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "spider_id" uuid`,

  // 3. 回填 runs.spider_id（按 spider_name 匹配 spiders.name，幂等）
  `UPDATE "runs" r
   SET "spider_id" = s."id"
   FROM "spiders" s
   WHERE r."spider_name" = s."name"
     AND r."spider_id" IS NULL`,

  // 4. 删除 runs.spider_name 上的旧 FK 约束（幂等）
  `ALTER TABLE "runs" DROP CONSTRAINT IF EXISTS "runs_spider_name_fkey"`,

  // 5. spiders 主键重建：id SET NOT NULL + DROP old PK + ADD new PK（幂等 DO 块）
  `DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'spiders'::regclass
      AND c.contype = 'p'
      AND a.attname = 'id'
  ) THEN
    ALTER TABLE "spiders" ALTER COLUMN "id" SET NOT NULL;
    ALTER TABLE "spiders" DROP CONSTRAINT IF EXISTS "spiders_pkey";
    ALTER TABLE "spiders" ADD PRIMARY KEY ("id");
  END IF;
END $$`,

  // 6. runs.spider_id FK 约束（幂等 DO 块）
  `DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'runs_spider_id_fkey'
      AND conrelid = 'runs'::regclass
  ) THEN
    ALTER TABLE "runs" ADD CONSTRAINT "runs_spider_id_fkey"
      FOREIGN KEY ("spider_id") REFERENCES "spiders"("id") ON DELETE CASCADE;
  END IF;
END $$`,

  // 7. runs.spider_id 索引（幂等）
  `CREATE INDEX IF NOT EXISTS "idx_runs_spider_id" ON "runs" ("spider_id")`,

  // ── displayName → name 重构：name 升级为用户自定义显示名，新增 type 为注册表键 ──────
  // 1. 加 type 列（存放注册表类型键，如 "youtube-search"）
  `ALTER TABLE "spiders" ADD COLUMN IF NOT EXISTS "type" varchar(64) NOT NULL DEFAULT ''`,
  // 2. 回填 type = 旧 name（注册表键），仅对 type 仍为空字符串的行执行，幂等
  `UPDATE "spiders" SET "type" = "name" WHERE "type" = ''`,
  // 3. 回填 name = 旧 display_name（用户标签），仅对 name 仍等于 type（尚未迁移）的行执行，幂等
  `UPDATE "spiders" SET "name" = "display_name" WHERE "name" = "type" AND "type" != ''`,
  // 4. name 列扩宽至 128，支持中文长名
  `ALTER TABLE "spiders" ALTER COLUMN "name" TYPE varchar(128)`,
  // 5. runs.spider_name 同步扩宽（存放 spider 显示名，中文可能较长）
  `ALTER TABLE "runs" ALTER COLUMN "spider_name" TYPE varchar(128)`,
  // 6. display_name 列保留但设默认值，避免新增行报 NOT NULL 错误
  `ALTER TABLE "spiders" ALTER COLUMN "display_name" SET DEFAULT ''`,
];

export interface MigrateResult {
  businessTablesReady: boolean;
  bossSchemaReady: boolean;
}

export async function runMigrations(databaseUrl: string): Promise<MigrateResult> {
  // 1) 业务表（用一个临时 PrismaClient，跑完即关）
  const client = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });
  try {
    // 逐条执行，不能合并成一个字符串：Prisma 用 prepared statement，
    // PostgreSQL 不允许单个 prepared statement 包含多条命令（error code 42601）。
    await client.$transaction(BUSINESS_SCHEMA_STMTS.map((sql) => client.$executeRawUnsafe(sql)));
  } finally {
    await client.$disconnect();
  }

  // 2) pg-boss 自管表（boss.start() 内部 idempotent 建表）
  const boss = new PgBoss({ connectionString: databaseUrl, schema: 'pgboss' });
  await boss.start();
  await boss.stop({ graceful: true });

  return { businessTablesReady: true, bossSchemaReady: true };
}
