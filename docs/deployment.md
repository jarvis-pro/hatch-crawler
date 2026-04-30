# 部署

> v1 的部署形态是 Docker Compose 本地一键起。
> 干净机器上 `git clone && docker compose up` 就能用。

## 一行起

```bash
git clone <repo>
cd hatch-crawler
cp .env.docker.example .env     # 默认值开箱可用
docker compose up --build
```

等到 `hatch-web` 日志出现 `[instrumentation] migrations done` + `[worker] started`，浏览器打开：

```
http://localhost:3000
```

## 服务拓扑

```
┌──────────────────────┐    ┌──────────────────────┐
│   hatch-postgres     │◄───│      hatch-web       │
│   postgres:16-alpine │    │   Next.js + worker   │
│   :5432              │    │   :3000              │
└──────────────────────┘    └──────────────────────┘
```

只有 **2 个容器**。

## 环境变量

`.env` 字段（来自 `.env.docker.example`）：

| 变量                | 默认值  | 说明             |
| ------------------- | ------- | ---------------- |
| `POSTGRES_DB`       | `hatch` | 库名             |
| `POSTGRES_USER`     | `hatch` | 账户             |
| `POSTGRES_PASSWORD` | `hatch` | 密码（生产请改） |
| `LOG_LEVEL`         | `info`  | pino 日志级别    |

`web` 容器内使用：

| 变量           | 由 compose 注入                                      | 说明         |
| -------------- | ---------------------------------------------------- | ------------ |
| `DATABASE_URL` | `postgres://${USER}:${PASSWORD}@postgres:5432/${DB}` | 连库         |
| `NODE_ENV`     | `production`                                         | Next.js 模式 |

## 启动后发生了什么

1. `postgres` 健康检查通过（`pg_isready`）
2. `web` 启动：
   - `instrumentation.ts` 触发 → `runMigrations()` 建业务表 + 启用 pgboss schema
   - `startWorker()` 拉起 pg-boss 消费 `crawl` 队列、清理 stale runs
3. Next.js 监听 `:3000`

整个过程**幂等**：重启 `web` 不会破坏数据，迁移会跳过已有表。

## 数据持久化

Postgres 的数据卷叫 `pg_data`：

```bash
docker volume inspect hatch-crawler_pg_data
```

要清空数据：

```bash
docker compose down -v   # ⚠️ 删除数据卷
```

## 添加示例 Spider 数据（可选）

首次启动后表是空的。可以跑一次 seed 灌点种子数据：

```bash
docker compose exec web sh -c \
  "DATABASE_URL=postgres://hatch:hatch@postgres/hatch node packages/db/scripts/seed.js" \
  || echo "seed 脚本路径仅 dev 模式有；生产镜像里不带 scripts/，需另想办法"
```

> 上面这条在 standalone 镜像里其实跑不通——seed 脚本不会被打包。
> 实际方案：在看板 `/spiders` 页面手工创建 Spider，或者跑一次 `pnpm --filter @hatch-crawler/db db:seed`（需要本地 dev 模式）。

## 排错

### `web` 容器卡在 "running migrations..."

通常是 `postgres` 还没就绪 / 凭据错。看日志：

```bash
docker compose logs postgres
docker compose logs web
```

### 端口冲突（5432 / 3000 被占）

改 `docker-compose.yml` 的端口映射：

```yaml
ports:
  - "127.0.0.1:5433:5432" # 把 5432 改成 5433
```

### 镜像构建失败：better-sqlite3 编译错

`apps/web` 不需要 `better-sqlite3` 跑，只是 workspace 里 `packages/crawler` 把它列为依赖。镜像构建 `pnpm install` 会尝试编译。

如果失败，临时方案：把 `package.json` 的 `pnpm.onlyBuiltDependencies` 列表里的 `better-sqlite3` 移到 `pnpm.allowedDeprecatedVersions` 或类似豁免位置。生产 v1 用不到 SQLite，未来可考虑把它从 `packages/crawler` 拎出来做单独的可选实现。

### 迁移失败：`gen_random_uuid()` 不存在

Postgres 13+ 自带这个函数。我们用 `postgres:16-alpine` 没问题。
如果你用的镜像是 12 或更老，需要 `CREATE EXTENSION pgcrypto`。

### 浏览器打开看不到 Sidebar / 样式坏掉

通常是 Tailwind 没编译进 standalone 包。检查：

```bash
docker compose exec web ls -la /app/apps/web/.next/static/css
```

应该有几个 `.css` 文件。没有的话重新 `docker compose build web --no-cache`。

## 生产化补强建议（v2）

当前 v1 的 Compose 配置满足"本地一键试用"，但暴露到公网前应该考虑：

- **认证**：`apps/web` 接 NextAuth
- **HTTPS**：前置 Caddy / Traefik 自动签证书
- **Postgres 密码**：用 Docker secrets，而不是 `.env`
- **资源限制**：`deploy.resources.limits` 限 CPU/内存
- **日志归集**：把 web 的 stdout 接 loki / 阿里云 SLS
- **备份**：定期 `pg_dump` 到对象存储

## 仅本地 dev（不用 Docker 跑 web）

如果只想用 Docker 跑 Postgres，本地跑 web：

```bash
# 1. 只起 postgres
docker compose up postgres -d

# 2. 本地装依赖
pnpm install

# 3. 创建 .env（apps/web 会读）
cat > apps/web/.env.local <<EOF
DATABASE_URL=postgres://hatch:hatch@localhost:5432/hatch
LOG_LEVEL=debug
EOF

# 4. 启动 dev 模式（HMR）
pnpm --filter @hatch-crawler/web dev
```
