/* eslint-disable no-console */
/**
 * 数据库迁移：业务表 + pg-boss 队列表。
 *
 * 用法：
 *   DATABASE_URL=postgres://... pnpm --filter @hatch-crawler/db db:migrate
 *
 * 顺序：
 *  1) drizzle migrate —— 业务表（来自 packages/db/migrations/*.sql）
 *  2) pg-boss start  —— 自动建 pgboss schema 下的队列表
 */

import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import PgBoss from "pg-boss";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsFolder = resolve(__dirname, "../migrations");

async function main(): Promise<void> {
  // 1) 业务表迁移
  console.log("→ running drizzle migrations...");
  const migrationClient = postgres(url!, { max: 1 });
  const db = drizzle(migrationClient);
  await migrate(db, { migrationsFolder });
  await migrationClient.end();
  console.log("✓ drizzle migrations done");

  // 2) pg-boss 表（boss.start() 内部会幂等地建表）
  console.log("→ initializing pg-boss schema...");
  const boss = new PgBoss({
    connectionString: url!,
    schema: "pgboss",
  });
  await boss.start();
  await boss.stop({ graceful: true });
  console.log("✓ pg-boss schema ready");

  console.log("\nAll migrations complete.");
}

main().catch((err: unknown) => {
  console.error("migration failed:", err);
  process.exit(1);
});
