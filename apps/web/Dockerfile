# syntax=docker/dockerfile:1.7
# ─────────────────────────────────────────────────────────────
# 多阶段构建 apps/web：
#   1. deps    —— pnpm 解析所有依赖（缓存友好）
#   2. builder —— 编译 Next.js standalone 产物
#   3. runner  —— 运行时镜像，只带必要文件
# ─────────────────────────────────────────────────────────────

# ============ Stage 1: deps =============
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo

# 复制全部 manifest（lockfile 走依赖图解析）
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY .npmrc ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/crawler/package.json ./packages/crawler/
COPY packages/db/package.json ./packages/db/
COPY apps/web/package.json ./apps/web/

# 用 frozen-lockfile 严格安装；better-sqlite3 是 cli/crawler 旧依赖，
# web 不需要它编译——但 onlyBuiltDependencies 还是要允许它跑 postinstall
RUN pnpm install --frozen-lockfile --prod=false


# ============ Stage 2: builder ==========
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo

# 把 deps 阶段的 node_modules 拿过来
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/packages ./packages
COPY --from=deps /repo/apps ./apps

# 复制源码
COPY . .

# 构建 web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @hatch-crawler/web build


# ============ Stage 3: runner ===========
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs
RUN adduser  --system --uid 1001 nextjs

# Next.js standalone 输出：只需要这三块
COPY --from=builder /repo/apps/web/.next/standalone ./
COPY --from=builder /repo/apps/web/.next/static ./apps/web/.next/static
# COPY --from=builder /repo/apps/web/public ./apps/web/public  # 没有 public 目录就不用

USER nextjs
EXPOSE 3000

# Next standalone 入口
CMD ["node", "apps/web/server.js"]
