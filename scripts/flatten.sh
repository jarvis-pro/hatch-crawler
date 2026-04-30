#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# scripts/flatten.sh —— 把 apps/web + packages/* 收拢成单 app
#
# 参考 hatch-kitora 的扁平结构：
#   src/
#     app/
#     components/
#     lib/
#       crawler/   (← packages/crawler/src)
#       db/        (← packages/db/src)
#       shared/    (← packages/shared/src)
#       worker/    (← apps/web/lib/worker)
#       env.ts logger.ts ...
#     instrumentation.ts
#
# 一次性脚本——跑完就可以从 git 删了。
# ─────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

# ─── preflight ──────────────────────────────────────────────
if [ -d src ]; then
  red "src/ 已存在——脚本只能在未扁平化的仓库上跑。中止。"
  exit 1
fi
if [ ! -d apps/web ] || [ ! -d packages ]; then
  red "找不到 apps/web 或 packages/——目录结构不对，中止。"
  exit 1
fi

# ─── 1. 移动目录（git mv 保留历史）──────────────────────────
step "1. 移动目录"

# apps/web 部分
git mv apps/web/app           src_app_tmp
git mv apps/web/components    src_components_tmp
git mv apps/web/lib           src_lib_tmp
git mv apps/web/instrumentation.ts  src_instrumentation_tmp.ts

# 顶层配置文件
git mv apps/web/next-env.d.ts        ./next-env.d.ts
git mv apps/web/postcss.config.mjs   ./postcss.config.mjs
git mv apps/web/tailwind.config.ts   ./tailwind.config.ts
# next.config.mjs / Dockerfile / package.json / tsconfig.json 后面整段重写，
# 不用 git mv，直接让旧的随 apps/web 一起删
rm -f apps/web/next.config.mjs apps/web/Dockerfile \
      apps/web/package.json apps/web/tsconfig.json
# .next 是构建产物，已在 .gitignore 里——直接 rm
rm -rf apps/web/.next

# packages 部分
git mv packages/crawler/src           src_lib_crawler_tmp
git mv packages/db/src                src_lib_db_tmp
git mv packages/shared/src            src_lib_shared_tmp
git mv packages/db/drizzle.config.ts  ./drizzle.config.ts

# scripts
mkdir -p scripts_new
git mv packages/db/scripts/migrate.ts       scripts_new/db-migrate.ts
git mv packages/db/scripts/seed.ts          scripts_new/db-seed.ts
git mv packages/crawler/scripts/smoke.ts    scripts_new/smoke.ts

# 现在把临时名字归位
mkdir -p src
mv src_app_tmp                src/app
mv src_components_tmp         src/components
mv src_lib_tmp                src/lib
mv src_instrumentation_tmp.ts src/instrumentation.ts
mv src_lib_crawler_tmp        src/lib/crawler
mv src_lib_db_tmp             src/lib/db
mv src_lib_shared_tmp         src/lib/shared
# scripts_new 合并到原 scripts/（这个脚本本身在 scripts/ 里）
mv scripts_new/db-migrate.ts  scripts/db-migrate.ts
mv scripts_new/db-seed.ts     scripts/db-seed.ts
mv scripts_new/smoke.ts       scripts/smoke.ts
rmdir scripts_new

# 删干净 apps/ 和 packages/
git rm -rf apps packages 2>/dev/null || true
rm -rf apps packages

# 删过时的根级配置
git rm -f pnpm-workspace.yaml tsconfig.base.json 2>/dev/null || true
rm -f pnpm-workspace.yaml tsconfig.base.json

# 旧的 dist/（packages 编译产物，已废）
rm -rf dist

green "✓ 目录移动完成"

# ─── 2. 重写 import ─────────────────────────────────────────
step "2. 重写 import: @hatch-crawler/* → @/lib/*"

# 给所有 src/ 和 scripts/ 下的 ts/tsx 来一遍
find src scripts -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | while IFS= read -r -d '' f; do
  # macOS 的 sed -i 需要 ''；Linux 不需要——用 perl 跨平台
  perl -i -pe '
    s|"\@hatch-crawler/crawler"|"\@/lib/crawler"|g;
    s|"\@hatch-crawler/db"|"\@/lib/db"|g;
    s|"\@hatch-crawler/shared"|"\@/lib/shared"|g;
  ' "$f"
done

# scripts/ 下的脚本用 tsx 跑，不走 webpack alias，要换成相对 import
perl -i -pe '
  s|"\@/lib/db"|"../src/lib/db/migrate"|g;
' scripts/db-migrate.ts

perl -i -pe '
  s|"../src/client"|"../src/lib/db/client"|g;
  s|"../src/schema"|"../src/lib/db/schema"|g;
' scripts/db-seed.ts

perl -i -pe '
  s|"../src/index"|"../src/lib/crawler"|g;
  s|"../src/spiders/nextjs-blog-spider"|"../src/lib/crawler/spiders/nextjs-blog-spider"|g;
  s|"../src/storage/storage"|"../src/lib/crawler/storage/storage"|g;
' scripts/smoke.ts

# scripts/db-migrate.ts 原本是 `from "../src/migrate"`，现在应该是 `from "../src/lib/db/migrate"`
# 上面那条 @/lib/db → ../src/lib/db/migrate 已经覆盖；但若 import 里没经过 @/lib/db
# （它就是 from "../src/migrate"），还要单独再修：
perl -i -pe 's|"../src/migrate"|"../src/lib/db/migrate"|g;' scripts/db-migrate.ts

green "✓ import 重写完成"

# ─── 3. 写新的根配置 ────────────────────────────────────────
step "3. 写入新的根级配置"

# package.json —— 合并四个
cat > package.json <<'JSON'
{
  "name": "hatch-crawler",
  "version": "0.2.0",
  "description": "A comprehensive Node.js/TypeScript crawler optimized for Next.js sites — full-stack with Web 看板",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.33.2",
  "engines": {
    "node": ">=22",
    "pnpm": ">=9"
  },
  "scripts": {
    "dev": "next dev --turbopack",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit",
    "lint": "next lint",
    "lint:fix": "next lint --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "check": "pnpm typecheck && pnpm lint && pnpm format:check",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx scripts/db-migrate.ts",
    "db:seed": "tsx scripts/db-seed.ts",
    "db:studio": "drizzle-kit studio",
    "smoke": "tsx scripts/smoke.ts",
    "prepare": "husky || true"
  },
  "dependencies": {
    "@hookform/resolvers": "^3.9.1",
    "@radix-ui/react-dialog": "^1.1.2",
    "@radix-ui/react-dropdown-menu": "^2.1.2",
    "@radix-ui/react-select": "^2.1.2",
    "@radix-ui/react-slot": "^1.1.0",
    "@radix-ui/react-tabs": "^1.1.1",
    "@tanstack/react-query": "^5.59.0",
    "better-sqlite3": "^11.3.0",
    "cheerio": "^1.0.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.1",
    "drizzle-orm": "^0.39.0",
    "got": "^14.4.2",
    "hpagent": "^1.2.0",
    "lucide-react": "^0.451.0",
    "next": "^15.0.3",
    "node-cron": "^3.0.3",
    "p-queue": "^8.0.1",
    "pg-boss": "^10.1.5",
    "pino": "^9.4.0",
    "pino-pretty": "^11.2.2",
    "postgres": "^3.4.5",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "react-hook-form": "^7.53.1",
    "sonner": "^1.7.0",
    "tailwind-merge": "^2.5.4",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@commitlint/cli": "^19.5.0",
    "@commitlint/config-conventional": "^19.5.0",
    "@eslint/js": "^9.12.0",
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.7.4",
    "@types/node-cron": "^3.0.11",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "drizzle-kit": "^0.30.0",
    "eslint": "^9.12.0",
    "eslint-config-next": "^15.0.3",
    "eslint-config-prettier": "^9.1.0",
    "globals": "^15.10.0",
    "husky": "^9.1.6",
    "lint-staged": "^15.2.10",
    "postcss": "^8.4.47",
    "prettier": "^3.3.3",
    "tailwindcss": "^3.4.14",
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "typescript-eslint": "^8.8.0"
  },
  "pnpm": {
    "onlyBuiltDependencies": [
      "better-sqlite3"
    ]
  },
  "lint-staged": {
    "*.{ts,tsx,js}": [
      "prettier --write"
    ],
    "*.{json,md,yml,yaml,css}": [
      "prettier --write"
    ]
  }
}
JSON

# tsconfig.json —— 单一文件，参考 hatch-kitora
cat > tsconfig.json <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "ES2022"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "allowJs": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "incremental": true,
    "jsx": "preserve",
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": [
    "next-env.d.ts",
    "**/*.ts",
    "**/*.tsx",
    ".next/types/**/*.ts"
  ],
  "exclude": ["node_modules", ".next", "dist"]
}
JSON

# next.config.mjs —— 砍掉 transpilePackages
cat > next.config.mjs <<'JS'
/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker 部署：standalone 输出，镜像里只放 .next/standalone + .next/static
  output: "standalone",

  // 这些是原生 / 服务器端模块，让 Node 原生 require，不让 webpack/Turbopack 打包：
  //   - pg-boss / postgres / better-sqlite3：原生 / 数据库驱动
  //   - node-cron：内部 fork() 启动守护进程，bundler 解析不了 __dirname
  serverExternalPackages: [
    "pg-boss",
    "postgres",
    "better-sqlite3",
    "node-cron",
  ],
};

export default nextConfig;
JS

# Dockerfile —— 单 package.json 后大幅简化
cat > Dockerfile <<'DOCKERFILE'
# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────
# 多阶段构建：deps → builder → runner
# 扁平化后只有一个 package.json，构建上下文从根目录直接来
# ─────────────────────────────────────────────────────────────

# ============ Stage 1: deps =============
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo

COPY pnpm-lock.yaml package.json .npmrc ./
RUN pnpm install --frozen-lockfile --prod=false


# ============ Stage 2: builder ==========
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build


# ============ Stage 3: runner ===========
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs
RUN adduser  --system --uid 1001 nextjs

# Next.js standalone 输出
COPY --from=builder /repo/.next/standalone ./
COPY --from=builder /repo/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
DOCKERFILE

green "✓ 根级配置写入完成"

# ─── 4. 更新 docker-compose.yml ────────────────────────────
step "4. 更新 docker-compose.yml: dockerfile 路径"

# 旧：dockerfile: apps/web/Dockerfile  → 新：dockerfile: Dockerfile
perl -i -pe 's|apps/web/Dockerfile|Dockerfile|g;' docker-compose.yml

green "✓ docker-compose.yml 更新完成"

# ─── 5. 更新 eslint.config.js ──────────────────────────────
step "5. 更新 eslint.config.js: 删除过渡期 ignore"

cat > eslint.config.js <<'JS'
// ESLint 9 flat config
// 文档：https://eslint.org/docs/latest/use/configure/configuration-files
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.next/**",
      "**/next-env.d.ts",
      "data/**",
      "coverage/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-void": ["error", { allowAsStatement: true }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  prettier,
);
JS

green "✓ eslint.config.js 更新完成"

# ─── 6. 更新 .prettierignore ───────────────────────────────
step "6. 更新 .prettierignore"

cat > .prettierignore <<'IGNORE'
node_modules
.next
dist
data
pnpm-lock.yaml
*.sqlite
*.sqlite-journal
.env
.env.*
!.env.example
IGNORE

# ─── 7. 更新 .dockerignore ─────────────────────────────────
step "7. 更新 .dockerignore"

cat > .dockerignore <<'IGNORE'
# 不复制到镜像构建上下文
node_modules
.next
dist
data
*.log
.env
.env.local
.env.*.local
.git
.github
.husky
.vscode
.idea
docs
*.md
!README.md
commit.sh
scripts/flatten.sh
IGNORE

# ─── 8. 重新装依赖 ─────────────────────────────────────────
step "8. 删旧 lockfile + pnpm install"

rm -f pnpm-lock.yaml
pnpm install

green "✓ 安装完成"

# ─── 9. typecheck ──────────────────────────────────────────
step "9. typecheck"

if pnpm typecheck; then
  green "✓ typecheck 通过"
else
  red "× typecheck 失败——看上面的报错处理"
  exit 1
fi

green ""
green "════════════════════════════════════════════════════════"
green "扁平化完成。现在可以："
green "  pnpm dev      # 起开发服务"
green "  pnpm smoke    # 引擎烟雾测试"
green ""
green "迁移脚本本身（scripts/flatten.sh）跑完就可以 git rm。"
green "════════════════════════════════════════════════════════"
