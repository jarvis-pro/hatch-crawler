import "dotenv/config";

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

export const config = {
  logLevel: str("LOG_LEVEL", "info"),
  concurrency: num("CONCURRENCY", 4),
  perHostIntervalMs: num("PER_HOST_INTERVAL_MS", 500),
  requestTimeoutMs: num("REQUEST_TIMEOUT_MS", 15000),
  retryAttempts: num("RETRY_ATTEMPTS", 3),
  sqlitePath: str("SQLITE_PATH", "./data/crawler.sqlite"),
  jsonlPath: str("JSONL_PATH", "./data/items.jsonl"),
  proxyList: list("PROXY_LIST"),
  cronSchedule: str("CRON_SCHEDULE", ""),
} as const;

export type Config = typeof config;
