import type { Config } from "drizzle-kit";

/**
 * drizzle-kit 配置：
 *  - schema 源：src/schema.ts
 *  - 输出：./migrations（生成 SQL）
 *  - 数据库：从 DATABASE_URL 读取（drizzle-kit studio / generate 时用）
 */
export default {
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ?? "postgres://hatch:hatch@localhost:5432/hatch",
  },
  casing: "snake_case",
} satisfies Config;
