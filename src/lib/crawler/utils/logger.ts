import pino, { type LoggerOptions } from 'pino';
import { config } from '../config/index';

/**
 * 全局 logger。
 *
 * 关于 pino-pretty 的说明：
 *   pino-pretty 通过 thread-stream 在子线程里输出格式化日志。
 *   在被 bundler（Next.js / webpack / Turbopack）打包的场景下，
 *   bundler 找不到 thread-stream 的 worker 文件路径，进程会崩。
 *   所以这里只在"裸 Node 运行"（CLI、smoke 脚本）启用 pretty，
 *   被打包的场景退回裸 pino（标准 JSON 日志）。
 */

const isBundled =
  // Next.js 进程：NEXT_RUNTIME = "nodejs" / "edge"
  Boolean(process.env.NEXT_RUNTIME) ||
  // 兜底：webpack 打包后 typeof __webpack_require__ !== "undefined"
  // @ts-expect-error 运行时才有的全局变量
  typeof __webpack_require__ === 'function';

const baseOptions: LoggerOptions = { level: config.logLevel };

const prettyOptions: LoggerOptions = {
  ...baseOptions,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    },
  },
};

export const logger = pino(isBundled ? baseOptions : prettyOptions);

export type Logger = typeof logger;
