/* eslint-disable no-console */
/**
 * 种子数据：开发环境用。
 *
 * 写入：
 *  - 一个示例 Spider：nextjs-blog
 *  - 默认全局参数：defaults
 *  - 默认 UA 池：ua_pool
 *  - 空代理池：proxy_pool
 *
 * 已存在则不覆盖（onConflictDoNothing）。
 */

import { closeDb, getDb } from "../src/client";
import { settings, spiders } from "../src/schema";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const db = getDb(url);

async function main(): Promise<void> {
  await db
    .insert(spiders)
    .values({
      name: "nextjs-blog",
      displayName: "Next.js 官博",
      description: "示例：抓取 https://nextjs.org/blog 文章",
      startUrls: ["https://nextjs.org/blog"],
      allowedHosts: ["nextjs.org"],
      maxDepth: 2,
      concurrency: 4,
      perHostIntervalMs: 500,
      enabled: true,
      cronSchedule: null,
    })
    .onConflictDoNothing();
  console.log("✓ spider: nextjs-blog");

  await db
    .insert(settings)
    .values({
      key: "defaults",
      value: {
        concurrency: 4,
        perHostIntervalMs: 500,
        requestTimeoutMs: 15000,
        retryAttempts: 3,
        logLevel: "info",
      },
    })
    .onConflictDoNothing();
  console.log("✓ setting: defaults");

  await db
    .insert(settings)
    .values({
      key: "ua_pool",
      value: {
        user_agents: [
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
        ],
      },
    })
    .onConflictDoNothing();
  console.log("✓ setting: ua_pool");

  await db
    .insert(settings)
    .values({
      key: "proxy_pool",
      value: { proxies: [] },
    })
    .onConflictDoNothing();
  console.log("✓ setting: proxy_pool");

  console.log("\nSeed complete.");
}

main()
  .catch((err: unknown) => {
    console.error("seed failed:", err);
    process.exit(1);
  })
  .finally(() => {
    void closeDb();
  });
