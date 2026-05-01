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

  // 一次性 backfill：把存量 nextjs-blog 条目标注 platform / kind / source_id
  // WHERE platform IS NULL 保证幂等（只跑一次）
  `UPDATE "items"
   SET "platform"  = 'nextjs-blog',
       "kind"      = 'article',
       "source_id" = "url"
   WHERE "spider" = 'nextjs-blog'
     AND "platform" IS NULL`,

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
