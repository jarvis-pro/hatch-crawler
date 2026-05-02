# 部署

> 当前部署形态是 Docker Compose 本地一键起。
> 干净机器上 `git clone && docker compose up` 就能用。

## 一行起

```bash
git clone <repo>
cd hatch-crawler
cp .env.example .env            # 默认值开箱可用，已有 .env 就跳过
docker compose up --build
```

等到 `hatch-web` 日志出现 `[instrumentation] migrations done`（后续 `startWorker()` 也会就绪），浏览器打开：

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

`.env` 字段（来自合并后的 `.env.example`，docker compose 只挑下面这几个用）：

| 变量                  | 默认值                 | 说明                                                            |
| --------------------- | ---------------------- | --------------------------------------------------------------- |
| `POSTGRES_DB`         | `hatch`                | 库名                                                            |
| `POSTGRES_USER`       | `hatch`                | 账户                                                            |
| `POSTGRES_PASSWORD`   | `hatch`                | 密码（生产请改）                                                |
| `LOG_LEVEL`           | `info`                 | pino 日志级别                                                   |
| `ACCOUNTS_MASTER_KEY` | 全零（不安全，仅 dev） | 凭据 AES-256-GCM 主密钥；hex 64 字符（32 字节）。**生产必须改** |
| `STORAGE_BACKEND`     | `local`                | 仅占位；目前只支持 `local`                                      |
| `STORAGE_LOCAL_ROOT`  | `./data`               | 本地文件根（保留接口）                                          |

> `.env` 里的 `DATABASE_URL` 是给"本地直接 `pnpm dev`"用的；
> docker compose 不消费它，会在 web 容器内用上面三个 `POSTGRES_*` 重新拼出 host=postgres 的连接串。

`web` 容器内使用：

| 变量           | 由 compose 注入                                      | 说明         |
| -------------- | ---------------------------------------------------- | ------------ |
| `DATABASE_URL` | `postgres://${USER}:${PASSWORD}@postgres:5432/${DB}` | 连库         |
| `NODE_ENV`     | `production`                                         | Next.js 模式 |

## 启动后发生了什么

1. `postgres` 健康检查通过（`pg_isready`）
2. `web` 启动：
   - `src/instrumentation.ts` 在 Node runtime 触发：
     - `runMigrations()` 建业务表 + 启用 pgboss schema
     - `ensureBuiltinSpiders()` 把内置 `url-extractor` spider 写入 `spiders` 表（已存在则跳过）
     - `startWorker()` 拉起 pg-boss 消费 `crawl` 队列、清理 stale runs（>30 分钟未更新的 running run 标 failed）+ 注册启用 spider 的 cron 调度
3. Next.js 监听 `:3000`（`HOSTNAME=0.0.0.0`，由 standalone 启动 `node server.js`）

整个过程**幂等**：重启 `web` 不会破坏数据，迁移会跳过已有表。

## 镜像内置依赖

Dockerfile `runner` 阶段额外安装：

- `ffmpeg`：视频/音频流处理（保留以备将来转码用）
- `yt-dlp`：视频详情页"下载"菜单走 yt-dlp 通道时调用，以及 `/api/items/:id/formats` 实时探测格式

本地 dev 用 `brew install ffmpeg yt-dlp`（macOS）或 `apt install ffmpeg && pip install yt-dlp`（Linux）。看板顶部 banner 会按 `/api/system/health` 检测结果提示缺失。

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

首次启动后表是空的。standalone 生产镜像不带 `scripts/`，所以 seed 走不通容器内执行。
推荐方案：

- 在看板 `/spiders` 页面手工创建 Spider；或
- 在本地 dev 模式（连同一个 Postgres）跑：
  ```bash
  DATABASE_URL=postgres://hatch:hatch@localhost:5432/hatch pnpm db:seed
  ```
  脚本入口是仓库根 `scripts/db-seed.ts`。

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
  - '127.0.0.1:5433:5432' # 把 5432 改成 5433
```

### 镜像构建失败：better-sqlite3 编译错

生产路径不会用到 `better-sqlite3`（仅 `src/lib/crawler/storage/sqlite-storage.ts` 在脱机调试时使用），
但它列在 `package.json` 的 dependencies 里，镜像构建 `pnpm install` 会尝试编译。

Dockerfile 的 `deps` 阶段已经预装 `python3 / make / g++` 来编译它。
如果还是挂掉，临时方案：把 `package.json` 的 `pnpm.onlyBuiltDependencies` 里的
`better-sqlite3` 暂时移除（`pnpm install` 会跳过它的 native build），
或者把 SQLite 实现拆成可选 dep。

### 迁移失败：`gen_random_uuid()` 不存在

Postgres 13+ 自带这个函数。我们用 `postgres:16-alpine` 没问题。
如果你用的镜像是 12 或更老，需要 `CREATE EXTENSION pgcrypto`。

### 浏览器打开看不到 Sidebar / 样式坏掉

通常是 Tailwind 没编译进 standalone 包。检查：

```bash
docker compose exec web ls -la /app/.next/static/css
```

应该有几个 `.css` 文件。没有的话重新 `docker compose build web --no-cache`。

## 生产化补强建议

当前的 Compose 配置满足"本地一键试用"，但暴露到公网前应该考虑：

- **认证**：在 `src/app` 上接 NextAuth
- **HTTPS**：前置 Caddy / Traefik 自动签证书
- **Postgres 密码 + ACCOUNTS_MASTER_KEY**：用 Docker secrets，而不是 `.env`
- **资源限制**：`deploy.resources.limits` 限 CPU/内存
- **日志归集**：把 web 的 stdout 接 loki / 阿里云 SLS
- **备份**：定期 `pg_dump` 到对象存储（凭据加密 payload 也在其中，丢了主密钥就解不出来——主密钥单独备份到密钥库）

## 仅本地 dev（不用 Docker 跑 web）

如果只想用 Docker 跑 Postgres，本地跑 web：

```bash
# 1. 只起 postgres
docker compose up postgres -d

# 2. 本地装依赖
pnpm install

# 3. 创建 .env（Next.js 会读根目录的 .env.local）
cat > .env.local <<EOF
DATABASE_URL=postgres://hatch:hatch@localhost:5432/hatch
LOG_LEVEL=debug
EOF

# 4. 启动 dev 模式（HMR + Turbopack）
pnpm dev
```
