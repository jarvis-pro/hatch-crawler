/**
 * 环境变量读取，server-only。
 * 任何 worker / API 路由都从这里取，不直接读 process.env。
 */
import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  logLevel: process.env.LOG_LEVEL ?? "info",
};
