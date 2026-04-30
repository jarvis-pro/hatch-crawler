/** @type {import('next').NextConfig} */
const nextConfig = {
  // 让 Next.js 监听 instrumentation.ts —— 进程启动时拉起 pg-boss worker
  experimental: {
    instrumentationHook: true,
  },
  // monorepo 包要在 server 端被 Next.js 编译
  transpilePackages: [
    "@hatch-crawler/crawler",
    "@hatch-crawler/db",
    "@hatch-crawler/shared",
  ],
  // pg-boss / postgres / better-sqlite3 是原生/服务器端模块，不能被打包到 client
  serverExternalPackages: ["pg-boss", "postgres", "better-sqlite3"],
};

export default nextConfig;
