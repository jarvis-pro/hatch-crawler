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
  // 3. 回填 name = 旧 display_name（用户标签）；列已被后续 DROP 时跳过（幂等）
  `DO $$ BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'spiders' AND column_name = 'display_name'
    ) THEN
      UPDATE "spiders" SET "name" = "display_name" WHERE "name" = "type" AND "type" != '';
    END IF;
  END $$`,
  // 4. name 列扩宽至 128，支持中文长名
  `ALTER TABLE "spiders" ALTER COLUMN "name" TYPE varchar(128)`,
  // 5. runs.spider_name 同步扩宽（存放 spider 显示名，中文可能较长）
  `ALTER TABLE "runs" ALTER COLUMN "spider_name" TYPE varchar(128)`,
  // 6. display_name 列设默认值，避免新增行报 NOT NULL 错误；列已 DROP 时跳过（幂等）
  `DO $$ BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'spiders' AND column_name = 'display_name'
    ) THEN
      ALTER TABLE "spiders" ALTER COLUMN "display_name" SET DEFAULT '';
    END IF;
  END $$`,

  // ── RFC 0003：任务模型重构 ────────────────────────────────────────────────────

  // spiders.task_kind：派生标记（subscription / batch / extract），不入引擎
  `ALTER TABLE "spiders" ADD COLUMN IF NOT EXISTS "task_kind" varchar(16)`,
  // 回填规则（幂等：WHERE task_kind IS NULL 防止重复覆盖）
  `UPDATE "spiders" SET "task_kind" = 'extract'      WHERE "type" = 'url-extractor' AND "task_kind" IS NULL`,
  `UPDATE "spiders" SET "task_kind" = 'subscription' WHERE "cron_schedule" IS NOT NULL AND "task_kind" IS NULL`,
  `UPDATE "spiders" SET "task_kind" = 'batch'        WHERE "task_kind" IS NULL`,
  // 设 NOT NULL（PostgreSQL 幂等，已有约束时为 no-op）
  `ALTER TABLE "spiders" ALTER COLUMN "task_kind" SET NOT NULL`,
  // task_kind 索引（按类型快速分页）
  `CREATE INDEX IF NOT EXISTS "idx_spiders_task_kind" ON "spiders" ("task_kind")`,

  // runs.task_kind：从 spider 同步写入，查询时免 JOIN
  `ALTER TABLE "runs" ADD COLUMN IF NOT EXISTS "task_kind" varchar(16)`,
  // 回填历史 runs（按关联 spider 的 task_kind 补填）
  `UPDATE "runs" r SET "task_kind" = s."task_kind"
   FROM "spiders" s WHERE r.spider_id = s.id AND r.task_kind IS NULL`,

  // items.trigger_kind：同步自 run.task_kind，用于 /data 来源 chip 过滤
  `ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "trigger_kind" varchar(16)`,
  // items.task_id：直接挂 spiders.id，展示来源链接用，不强制 FK
  `ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "task_id" uuid`,
  `CREATE INDEX IF NOT EXISTS "idx_items_trigger_kind" ON "items" ("trigger_kind") WHERE "trigger_kind" IS NOT NULL`,
  // 回填历史 items
  `UPDATE "items" i SET "trigger_kind" = r."task_kind", "task_id" = r."spider_id"
   FROM "runs" r WHERE i.run_id = r.id AND i.trigger_kind IS NULL AND r.task_kind IS NOT NULL`,

  // ── RFC 0003 阶段二：历史遗留列清理 ─────────────────────────────────────────

  // drop spiders.spider_type（被 type 列取代）
  `ALTER TABLE "spiders" DROP COLUMN IF EXISTS "spider_type"`,
  // drop spiders.display_name（被 name 列取代）
  `ALTER TABLE "spiders" DROP COLUMN IF EXISTS "display_name"`,

  // ── 阶段二：webhook_deliveries 表（Webhook 投递记录）───────────────────────

  `CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
    "id" serial PRIMARY KEY,
    "event_type"    varchar(64)  NOT NULL,
    "payload"       jsonb        NOT NULL,
    "url"           text         NOT NULL,
    "status"        varchar(16)  NOT NULL DEFAULT 'pending',
    "attempts"      integer      NOT NULL DEFAULT 0,
    "last_status"   integer,
    "last_error"    text,
    "created_at"    timestamp    NOT NULL DEFAULT now(),
    "delivered_at"  timestamp
  )`,
  `CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_status" ON "webhook_deliveries" ("status")`,
  `CREATE INDEX IF NOT EXISTS "idx_webhook_deliveries_created_at" ON "webhook_deliveries" ("created_at")`,

  // ── extract_jobs：快取（按链接抓取）独立任务表 ───────────────────────────────
  // 与 runs 解耦：extract 链路不再借用 spider/run/event 体系，自带任务壳与状态字段。
  // results jsonb 形态：
  //   { [canonicalUrl]: { originalUrl, platform, status: 'pending'|'succeeded'|'failed',
  //                        errorCode?, errorMessage?, itemId?, finishedAt? } }
  `CREATE TABLE IF NOT EXISTS "extract_jobs" (
    "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "submitted_urls"  jsonb       NOT NULL DEFAULT '[]'::jsonb,
    "results"         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    "total"           integer     NOT NULL DEFAULT 0,
    "succeeded"       integer     NOT NULL DEFAULT 0,
    "failed"          integer     NOT NULL DEFAULT 0,
    "status"          varchar(16) NOT NULL DEFAULT 'running',
    "created_at"      timestamp   NOT NULL DEFAULT now(),
    "finished_at"     timestamp
  )`,
  `CREATE INDEX IF NOT EXISTS "idx_extract_jobs_created_at" ON "extract_jobs" ("created_at")`,
  `CREATE INDEX IF NOT EXISTS "idx_extract_jobs_status" ON "extract_jobs" ("status")`,

  // items 加 extract_job_id 列 + FK + 索引（幂等）
  `ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "extract_job_id" uuid`,
  `DO $$ BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'items_extract_job_id_fkey'
        AND conrelid = 'items'::regclass
    ) THEN
      ALTER TABLE "items" ADD CONSTRAINT "items_extract_job_id_fkey"
        FOREIGN KEY ("extract_job_id") REFERENCES "extract_jobs"("id") ON DELETE SET NULL;
    END IF;
  END $$`,
  `CREATE INDEX IF NOT EXISTS "idx_items_extract_job_id" ON "items" ("extract_job_id") WHERE "extract_job_id" IS NOT NULL`,

  // ── url-extractor 内置 spider 下线：删除遗留 spider 行（关联 runs 级联清理；
  //    items.run_id 由 ON DELETE SET NULL 保留）。幂等：已无对应行时 0 删除。
  `DELETE FROM "spiders" WHERE "type" = 'url-extractor'`,

  // ── items.id 从 serial 改为 uuid ─────────────────────────────────────────
  // 动机：避免自增数对外暴露内容总量。items.id 当前没有任何外键引用，
  //   切换是安全的；老的 serial 值不保留（外部如果靠这个数 id 引用，会失效）。
  // 幂等：通过 information_schema.columns 检测当前 id 列的数据类型，仅在
  //   仍是整数类型（integer/bigint）时执行一次 ALTER；之后所有启动都是 no-op。
  `DO $$
    DECLARE
      cur_type text;
    BEGIN
      SELECT data_type INTO cur_type
      FROM information_schema.columns
      WHERE table_name = 'items' AND column_name = 'id';

      IF cur_type IN ('integer', 'bigint') THEN
        -- 1. 删除旧 PK 约束（serial 默认名是 items_pkey）
        ALTER TABLE "items" DROP CONSTRAINT IF EXISTS "items_pkey";
        -- 2. 释放并删除关联序列（autoincrement 来源）
        ALTER TABLE "items" ALTER COLUMN "id" DROP DEFAULT;
        DROP SEQUENCE IF EXISTS "items_id_seq";
        -- 3. 直接转换列类型为 uuid，并为每行生成新值
        --    USING gen_random_uuid() 在 ALTER COLUMN TYPE 时按行调用一次
        ALTER TABLE "items" ALTER COLUMN "id" TYPE uuid USING gen_random_uuid();
        -- 4. 设置默认值与主键
        ALTER TABLE "items" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
        ALTER TABLE "items" ADD PRIMARY KEY ("id");
      END IF;
    END $$`,
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
