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
 * 已存在则不覆盖（skipDuplicates / 仅 create）。
 */

import { closeDb, getDb } from '../src/lib/db/client';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const db = getDb(url);

async function main(): Promise<void> {
  // seed 使用原始 SQL，兼容 Prisma generate 前 type 列不在生成类型里的情况
  const existingRows = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "spiders" WHERE "type" = 'nextjs-blog' LIMIT 1`,
  );
  if (existingRows.length === 0) {
    await db.$executeRawUnsafe(
      `INSERT INTO "spiders" ("name", "type", "display_name", "description", "start_urls", "allowed_hosts", "max_depth", "concurrency", "per_host_interval_ms", "enabled", "cron_schedule")
       VALUES ($1, $2, $1, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10)`,
      'Next.js 官博',
      'nextjs-blog',
      '示例：抓取 https://nextjs.org/blog 文章',
      JSON.stringify(['https://nextjs.org/blog']),
      JSON.stringify(['nextjs.org']),
      2,
      4,
      500,
      true,
      null,
    );
  }
  console.log('✓ spider: nextjs-blog');

  const seedSettings: { key: string; value: unknown }[] = [
    {
      key: 'defaults',
      value: {
        concurrency: 4,
        perHostIntervalMs: 500,
        requestTimeoutMs: 15000,
        retryAttempts: 3,
        logLevel: 'info',
      },
    },
    {
      key: 'ua_pool',
      value: {
        user_agents: [
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
        ],
      },
    },
    {
      key: 'proxy_pool',
      value: { proxies: [] },
    },
  ];
  for (const s of seedSettings) {
    const exists = await db.setting.findUnique({ where: { key: s.key } });
    if (!exists) {
      await db.setting.create({
        data: { key: s.key, value: s.value as object },
      });
    }
    console.log(`✓ setting: ${s.key}`);
  }

  console.log('\nSeed complete.');
}

main()
  .catch((err: unknown) => {
    console.error('seed failed:', err);
    process.exit(1);
  })
  .finally(() => {
    void closeDb();
  });
