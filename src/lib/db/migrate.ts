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

const BUSINESS_SCHEMA_SQL = `
-- ── 枚举 ──────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "run_status" AS ENUM ('queued', 'running', 'completed', 'failed', 'stopped');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "event_level" AS ENUM ('debug', 'info', 'warn', 'error');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── spiders ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "spiders" (
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
);

-- ── runs ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "runs" (
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
);
CREATE INDEX IF NOT EXISTS "idx_runs_status" ON "runs" ("status");
CREATE INDEX IF NOT EXISTS "idx_runs_spider" ON "runs" ("spider_name", "created_at");

-- ── events ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "events" (
  "id" serial PRIMARY KEY,
  "run_id" uuid NOT NULL REFERENCES "runs"("id") ON DELETE CASCADE,
  "level" "event_level" NOT NULL,
  "type" varchar(32) NOT NULL,
  "message" text,
  "payload" jsonb DEFAULT '{}'::jsonb,
  "occurred_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_events_run_time" ON "events" ("run_id", "occurred_at");

-- ── items ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "items" (
  "id" serial PRIMARY KEY,
  "run_id" uuid REFERENCES "runs"("id") ON DELETE SET NULL,
  "spider" varchar(64) NOT NULL,
  "type" varchar(32) NOT NULL,
  "url" text NOT NULL,
  "url_hash" char(40) NOT NULL,
  "content_hash" char(40) NOT NULL,
  "payload" jsonb NOT NULL,
  "fetched_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_items_spider_url_content" ON "items" ("spider", "url_hash", "content_hash");
CREATE INDEX IF NOT EXISTS "idx_items_spider_type" ON "items" ("spider", "type");
CREATE INDEX IF NOT EXISTS "idx_items_fetched_at" ON "items" ("fetched_at");

-- ── visited ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "visited" (
  "spider" varchar(64) NOT NULL,
  "url_hash" char(40) NOT NULL,
  "url" text NOT NULL,
  "visited_at" timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY ("spider", "url_hash")
);

-- ── settings ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "settings" (
  "key" varchar(64) PRIMARY KEY,
  "value" jsonb NOT NULL,
  "updated_at" timestamp NOT NULL DEFAULT now()
);
`;

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
    await client.$executeRawUnsafe(BUSINESS_SCHEMA_SQL);
  } finally {
    await client.$disconnect();
  }

  // 2) pg-boss 自管表（boss.start() 内部 idempotent 建表）
  const boss = new PgBoss({ connectionString: databaseUrl, schema: 'pgboss' });
  await boss.start();
  await boss.stop({ graceful: true });

  return { businessTablesReady: true, bossSchemaReady: true };
}
