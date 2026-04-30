import { config } from "./config/index.js";
import { logger } from "./utils/logger.js";
import { runSpider } from "./core/spider.js";
import { scheduleOrRunOnce } from "./core/scheduler.js";
import { SqliteStorage } from "./storage/sqlite-storage.js";
import { JsonlWriter } from "./storage/file-storage.js";
import { NextJsBlogSpider } from "./spiders/nextjs-blog-spider.js";

async function main(): Promise<void> {
  logger.info({ config }, "starting hatch-crawler");

  const storage = new SqliteStorage(config.sqlitePath);
  const jsonl = new JsonlWriter(config.jsonlPath);

  const job = async () => {
    const spider = new NextJsBlogSpider();
    const stats = await runSpider(spider, { storage, jsonl });
    logger.info({ stats }, "crawl complete");
  };

  const handle = scheduleOrRunOnce(config.cronSchedule, job);

  // Graceful shutdown
  const shutdown = async () => {
    logger.info("shutting down");
    handle.stop();
    await jsonl.close();
    storage.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (!config.cronSchedule) {
    // One-shot: wait for the job, clean up, exit normally.
    await handle.done;
    await jsonl.close();
    storage.close();
  }
}

main().catch((err) => {
  logger.error({ err }, "fatal");
  process.exit(1);
});
