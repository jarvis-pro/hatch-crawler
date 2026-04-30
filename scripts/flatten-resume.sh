#!/usr/bin/env bash
# 续跑：从 src_*_tmp 已移动的状态接着完成扁平化
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

green() { printf '\033[32m%s\033[0m\n' "$*"; }
step() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }

# ─── 1. 把 src_*_tmp 归位到 src/ ────────────────────────────
step "1. src_*_tmp → src/"

mkdir -p src

# app/components/lib/instrumentation 已经在 src_*_tmp 里
[ -d src_app_tmp ]              && mv src_app_tmp        src/app
[ -d src_components_tmp ]       && mv src_components_tmp src/components
[ -d src_lib_tmp ]              && mv src_lib_tmp        src/lib
[ -f src_instrumentation_tmp.ts ] && mv src_instrumentation_tmp.ts src/instrumentation.ts

green "✓"

# ─── 2. 顶层配置文件：apps/web/* → 根 ───────────────────────
step "2. apps/web/{configs} → 根目录"

# 这些是 gitignore 或非 git 的，直接 mv
[ -f apps/web/next-env.d.ts ]       && mv apps/web/next-env.d.ts       ./next-env.d.ts || true
[ -f apps/web/postcss.config.mjs ]  && mv apps/web/postcss.config.mjs  ./postcss.config.mjs || true
[ -f apps/web/tailwind.config.ts ]  && mv apps/web/tailwind.config.ts  ./tailwind.config.ts || true

# 这几个会被新文件覆盖，直接删
rm -f apps/web/next.config.mjs apps/web/Dockerfile \
      apps/web/package.json apps/web/tsconfig.json \
      apps/web/tsconfig.tsbuildinfo

# .next 是构建产物
rm -rf apps/web/.next

green "✓"

# ─── 3. packages/* → src/lib/ ──────────────────────────────
step "3. packages/* → src/lib/"

mkdir -p src/lib

[ -d packages/crawler/src ] && mv packages/crawler/src src/lib/crawler
[ -d packages/db/src ]      && mv packages/db/src      src/lib/db
[ -d packages/shared/src ]  && mv packages/shared/src  src/lib/shared

[ -f packages/db/drizzle.config.ts ] && mv packages/db/drizzle.config.ts ./drizzle.config.ts

# scripts
[ -f packages/db/scripts/migrate.ts ]    && mv packages/db/scripts/migrate.ts    scripts/db-migrate.ts
[ -f packages/db/scripts/seed.ts ]       && mv packages/db/scripts/seed.ts       scripts/db-seed.ts
[ -f packages/crawler/scripts/smoke.ts ] && mv packages/crawler/scripts/smoke.ts scripts/smoke.ts

green "✓"

# ─── 4. 删 apps/ packages/ 旧目录 ──────────────────────────
step "4. 删除 apps/ packages/"

rm -rf apps packages dist
rm -f pnpm-workspace.yaml tsconfig.base.json

green "✓"

# ─── 5. 重写 import: @hatch-crawler/* → @/lib/* ────────────
step "5. 重写 import"

find src scripts -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | while IFS= read -r -d '' f; do
  perl -i -pe '
    s|"\@hatch-crawler/crawler"|"\@/lib/crawler"|g;
    s|"\@hatch-crawler/db"|"\@/lib/db"|g;
    s|"\@hatch-crawler/shared"|"\@/lib/shared"|g;
  ' "$f"
done

# scripts/ 用 tsx 跑，相对 import 更稳
perl -i -pe 's|"../src/migrate"|"../src/lib/db/migrate"|g;' scripts/db-migrate.ts
perl -i -pe '
  s|"../src/client"|"../src/lib/db/client"|g;
  s|"../src/schema"|"../src/lib/db/schema"|g;
' scripts/db-seed.ts
perl -i -pe '
  s|"../src/index"|"../src/lib/crawler"|g;
  s|"../src/spiders/nextjs-blog-spider"|"../src/lib/crawler/spiders/nextjs-blog-spider"|g;
  s|"../src/storage/storage"|"../src/lib/crawler/storage/storage"|g;
' scripts/smoke.ts

green "✓"

# ─── 6. 写新的根级配置 ─────────────────────────────────────
step "6. 写新的根级配置"

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
    "*.{ts,tsx,js}": ["prettier --write"],
    "*.{json,md,yml,yaml,css}": ["prettier --write"]
  }
}
JSON

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

cat > Dockerfile <<'DOCKERFILE'
# syntax=docker/dockerfile:1.7
# 多阶段构建：deps → builder → runner
# 扁平化后只有一个 package.json

FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo

COPY pnpm-lock.yaml package.json .npmrc ./
RUN pnpm install --frozen-lockfile --prod=false

FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs
RUN adduser  --system --uid 1001 nextjs

COPY --from=builder /repo/.next/standalone ./
COPY --from=builder /repo/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
DOCKERFILE

# docker-compose.yml: 路径改正
perl -i -pe 's|apps/web/Dockerfile|Dockerfile|g;' docker-compose.yml

# eslint 简化
cat > eslint.config.js <<'JS'
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

cat > .dockerignore <<'IGNORE'
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
scripts/flatten*.sh
IGNORE

green "✓"

# ─── 7. 重新装依赖 ─────────────────────────────────────────
step "7. rm pnpm-lock + pnpm install"
rm -f pnpm-lock.yaml
pnpm install
green "✓"

# ─── 8. typecheck ──────────────────────────────────────────
step "8. typecheck"
pnpm typecheck && green "✓ typecheck 通过" || true

green ""
green "════════════════════════════════════════════════════════"
green "扁平化完成。"
green "  pnpm dev      # 起开发"
green "  pnpm smoke    # 引擎烟雾测试"
green "════════════════════════════════════════════════════════"
