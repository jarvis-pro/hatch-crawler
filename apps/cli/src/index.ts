/**
 * CLI 入口（v1 monorepo 形态）。
 *
 * 行为与 v0 等价：读环境变量、跑示例 Spider、把结果落到本地 SQLite + JSONL。
 *
 * 全栈版本里这条入口是给开发者本地快速试跑/调试用的，
 * 真正的生产数据由 apps/worker 写入 Postgres。
 */

import "dotenv/config";
import {
  JsonlWriter,
  NextJsBlogSpider,
  SqliteStorage,
  logger,
  runSpider,
  scheduleOrRunOnce,
  setCrawlerConfig,
} from "@hatch-crawler/crawler";
import type { CrawlerEvent } from "@hatch-crawler/shared";

interface CliEnv {
  logLevel: string;
  concurrency: number;
  perHostIntervalMs: number;
  requestTimeoutMs: number;
  retryAttempts: number;
  sqlitePath: string;
  jsonlPath: string;
  proxyList: string[];
  cronSchedule: string;
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function str(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

function list(key: string): string[] {
  const v = process.env[key];
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadEnv(): CliEnv {
  return {
    logLevel: str("LOG_LEVEL", "info"),
    concurrency: num("CONCURRENCY", 4),
    perHostIntervalMs: num("PER_HOST_INTERVAL_MS", 500),
    requestTimeoutMs: num("REQUEST_TIMEOUT_MS", 15000),
    retryAttempts: num("RETRY_ATTEMPTS", 3),
    sqlitePath: str("SQLITE_PATH", "./data/crawler.sqlite"),
    jsonlPath: str("JSONL_PATH", "./data/items.jsonl"),
    proxyList: list("PROXY_LIST"),
    cronSchedule: str("CRON_SCHEDULE", ""),
  };
}

async function main(): Promise<void> {
  const env = loadEnv();

  // 1) 把 CLI 解出的环境变量推给库
  setCrawlerConfig({
    logLevel: env.logLevel,
    concurrency: env.concurrency,
    perHostIntervalMs: env.perHostIntervalMs,
    requestTimeoutMs: env.requestTimeoutMs,
    retryAttempts: env.retryAttempts,
    proxyList: env.proxyList,
  });
  // pino 在初始化时锁定 level；这里同步一下让 LOG_LEVEL 生效
  logger.level = env.logLevel;

  logger.info({ env }, "starting hatch-crawler CLI");

  const storage = new SqliteStorage(env.sqlitePath);
  const jsonl = new JsonlWriter(env.jsonlPath);

  // CLI 通过 onEvent 桥接到 JSONL：每条新条目就写一行
  const onEvent = (e: CrawlerEvent): void => {
    if (e.type === "emitted" && e.isNew) {
      jsonl.write({
        type: e.itemType,
        url: e.url,
        emitted_at: e.at,
      });
    }
  };

  const job = async () => {
    const spider = new NextJsBlogSpider();
    const stats = await runSpider(spider, { storage, onEvent });
    logger.info({ stats }, "crawl complete");
  };

  const handle = scheduleOrRunOnce(env.cronSchedule, job);

  const shutdown = async () => {
    logger.info("shutting down");
    handle.stop();
    await jsonl.close();
    await storage.close?.();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (!env.cronSchedule) {
    await handle.done;
    await jsonl.close();
    await storage.close?.();
  }
}

main().catch((err: unknown) => {
  logger.error({ err: (err as Error).message }, "fatal");
  process.exit(1);
});
