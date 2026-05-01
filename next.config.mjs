/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker 部署：standalone 输出，镜像里只放 .next/standalone + .next/static
  output: 'standalone',

  // 这些是原生 / 服务器端模块，让 Node 原生 require，不让 webpack/Turbopack 打包：
  //   - pg-boss / postgres / better-sqlite3：原生 / 数据库驱动
  //   - node-cron：内部 fork() 启动守护进程，bundler 解析不了 __dirname
  serverExternalPackages: ['pg-boss', 'postgres', 'better-sqlite3', 'node-cron'],
};

export default nextConfig;
