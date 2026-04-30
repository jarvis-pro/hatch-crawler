/* eslint-disable no-console */
/**
 * 手动迁移入口（开发期可用）。
 *
 * 实际生产路径：web 启动时 instrumentation 会自动调 runMigrations，
 * 所以这个脚本主要用于开发调试或排错。
 *
 * 用法：
 *   DATABASE_URL=postgres://... pnpm db:migrate
 */

import { runMigrations } from "../src/lib/db/migrate";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

async function main(): Promise<void> {
  console.log("→ running migrations...");
  const result = await runMigrations(url!);
  console.log("✓ business tables:", result.businessTablesReady);
  console.log("✓ pg-boss schema:", result.bossSchemaReady);
  console.log("\nAll migrations complete.");
}

main().catch((err: unknown) => {
  console.error("migration failed:", err);
  process.exit(1);
});
