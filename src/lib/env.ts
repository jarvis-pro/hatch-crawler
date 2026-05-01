/**
 * 环境变量读取，server-only。
 * 任何 worker / API 路由都从这里取，不直接读 process.env。
 *
 * 用 getter 实现"懒检查"——只在真正访问字段时才校验，
 * 避免 import 这个文件就把进程整崩（比如 dev 服务起来前缺 DATABASE_URL）。
 */
import 'server-only';

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env: ${name}\n` +
        `请在项目根目录创建 .env.local 或 .env，比如：\n` +
        `  DATABASE_URL=postgres://hatch:hatch@localhost:5432/hatch\n` +
        `或先 \`docker compose up postgres -d\` 起一个本地 Postgres。`,
    );
  }
  return v;
}

export const env = {
  get databaseUrl(): string {
    return required('DATABASE_URL');
  },
  get logLevel(): string {
    return process.env.LOG_LEVEL ?? 'info';
  },
};
