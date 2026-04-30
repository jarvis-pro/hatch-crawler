#!/usr/bin/env bash
set -e

# ─────────────────────────────────────────────────────────────
# Commit: 扁平化重构 —— 从 monorepo 收拢成单 Next.js app
#
# 动机：
#   v1 不再有 CLI、worker 也合进 web 进程、爬虫引擎也不外发包，
#   monorepo（apps/web + packages/{crawler,db,shared}）的复用前提全消失。
#   带来的成本却高：
#     * transpilePackages + workspace 解析路径让 Turbopack 反复出问题
#     * serverExternalPackages 一长串绕原生模块
#     * `.js` 扩展名 / 静态 vs 动态 import 解析差异
#     * workspace re-export 把 node-cron / thread-stream 拖进 web bundle
#   所有这些坑在扁平结构下根本不存在（参考 hatch-kitora）。
#
# 结构变化：
#   apps/web/app                 → src/app
#   apps/web/components          → src/components
#   apps/web/lib                 → src/lib
#   apps/web/instrumentation.ts  → src/instrumentation.ts
#   packages/crawler/src         → src/lib/crawler
#   packages/db/src              → src/lib/db
#   packages/shared/src          → src/lib/shared
#   packages/db/scripts/*        → scripts/db-*.ts
#   packages/crawler/scripts/*   → scripts/smoke.ts
#   apps/web/{Dockerfile,next.config.mjs,postcss.config.mjs,
#             tailwind.config.ts,next-env.d.ts}
#                                → 根目录
#
# 配置收敛：
#   * 单一 package.json（合并四个）
#   * 单一 tsconfig.json（带 @/* → ./src/* 别名）
#   * 删 pnpm-workspace.yaml / tsconfig.base.json
#   * next.config.mjs 砍掉 transpilePackages
#   * Dockerfile 大幅简化
#
# import 重写：
#   "@hatch-crawler/crawler" → "@/lib/crawler"
#   "@hatch-crawler/db"      → "@/lib/db"
#   "@hatch-crawler/shared"  → "@/lib/shared"
# ─────────────────────────────────────────────────────────────

# 一次性大批量提交：所有移动 + 重写 + 配置变更
git add -A

git commit -m "refactor: 扁平化重构 —— monorepo 收拢成单 Next.js app

参考 hatch-kitora 的扁平结构。v1 不再外发引擎包、CLI 已废、worker
合进 web 进程，monorepo 的复用前提消失，但维护成本（transpilePackages
+ workspace 解析路径 + bundler 跨包 hack）很高。

- apps/web 与 packages/{crawler,db,shared} 合并为 src/
- 单 package.json / tsconfig.json
- next.config.mjs 砍掉 transpilePackages
- import 路径全部改用 @/lib/* 别名
- Dockerfile 简化为单 stage 复制根目录"

# 删迁移脚本——一次性工具，留 git 历史里就够
git rm -f scripts/flatten.sh scripts/flatten-resume.sh
git commit -m "chore: 删除一次性扁平化迁移脚本"
