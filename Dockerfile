# syntax=docker/dockerfile:1.7
# 多阶段构建：deps → builder → runner
# 扁平化后只有一个 package.json

FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /repo

COPY pnpm-lock.yaml package.json .npmrc ./
COPY prisma ./prisma
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
