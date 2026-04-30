/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker 部署：用 standalone 输出，构建后镜像只需要 .next/standalone + .next/static + public
  output: "standalone",

  // Next.js 15 起 instrumentation.ts 是默认特性，不再需要 experimental.instrumentationHook

  // monorepo 包要在 server 端被 Next.js 编译
  transpilePackages: [
    "@hatch-crawler/crawler",
    "@hatch-crawler/db",
    "@hatch-crawler/shared",
  ],

  // 这些是原生/服务器端模块，让 Node.js 原生 require，不让 webpack/Turbopack 打包：
  //  - pg-boss / postgres / better-sqlite3：原生 / 数据库驱动
  //  - node-cron：内部用 fork() 启动守护进程，bundler 解析不了 __dirname 路径
  serverExternalPackages: [
    "pg-boss",
    "postgres",
    "better-sqlite3",
    "node-cron",
  ],
};

export default nextConfig;
