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

# RFC 0002 Phase B/C：媒体下载与转码所需的系统依赖
#  - ffmpeg：视频→音频转码（Phase B）
#  - yt-dlp：YouTube 等站点视频下载（Phase C）
# 安装到镜像里，避免运行期 spawn 找不到二进制
RUN apk add --no-cache ffmpeg yt-dlp

RUN addgroup --system --gid 1001 nodejs
RUN adduser  --system --uid 1001 nextjs

COPY --from=builder /repo/.next/standalone ./
COPY --from=builder /repo/.next/static ./.next/static

# data/ 用于 LocalFileStorage（attachments 落地）；让 nextjs 用户可写
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data
VOLUME ["/app/data"]

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
