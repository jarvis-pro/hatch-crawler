# 数据模型

> 本文定义 hatch-crawler 当前的所有持久化数据结构。
> 数据库为 **Postgres 16**，ORM 为 **Prisma**。
> 任务队列复用同一个 Postgres，由 **pg-boss** 自动管理 `pgboss` schema 下的队列表（不在本文中描述）。

## ER 概览

```
┌─────────────┐         ┌─────────────┐
│   spiders   │         │  settings   │
│             │         │             │
│  name (PK)  │         │  key (PK)   │
│  config     │         │  value JSON │
└──────┬──────┘         └─────────────┘
       │
       │ 1:N
       ▼
┌─────────────┐ 1:N    ┌─────────────┐
│    runs     │───────►│   events    │
│             │        │             │
│  id (PK)    │        │  id (PK)    │
│  spider_fk  │        │  run_id_fk  │
│  status     │        │  level      │
│  started_at │        │  type       │
│  stats      │        │  payload    │
└──────┬──────┘        └─────────────┘
       │
       │ 1:N
       ▼
┌─────────────┐
│    items    │
│             │
│  id (PK)    │
│  run_id_fk  │
│  spider     │
│  url        │
│  payload    │
│  url_hash   │
│  content_hash│
└─────────────┘

       ┌─────────────┐
       │   visited   │   ← URL 指纹去重表（无外键，独立索引）
       │             │
       │  url_hash   │
       │  spider     │
       │  visited_at │
       └─────────────┘
```

## 表定义（Prisma schema）

下面是各表的 Prisma 描述，权威定义在 `prisma/schema.prisma`。
所有表的运行时建表语句以 `src/lib/db/migrate.ts` 里的内联 SQL 为准
（`prisma migrate` 工具链保留为可选路径，见下方"迁移策略"）。

### spiders

注册的 Spider 定义。Worker 启动时根据这张表加载（也可以写代码硬编码，看板上把"用户可改的覆盖参数"存这里）。

```prisma
model Spider {
  name              String   @id @db.VarChar(64)              // "nextjs-blog"
  displayName       String   @map("display_name") @db.VarChar(128)
  description       String?
  startUrls         Json     @map("start_urls")               // string[]
  allowedHosts      Json     @default("[]") @map("allowed_hosts")  // string[]
  maxDepth          Int      @default(2) @map("max_depth")
  concurrency       Int      @default(4)
  perHostIntervalMs Int      @default(500) @map("per_host_interval_ms")
  enabled           Boolean  @default(true)
  cronSchedule      String?  @map("cron_schedule") @db.VarChar(64)  // null = 不自动调度
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamp(6)
  updatedAt         DateTime @default(now()) @map("updated_at") @db.Timestamp(6)

  runs Run[]

  @@map("spiders")
}
```

### runs

每次抓取的实例。包含状态和聚合统计。

```prisma
enum RunStatus {
  queued     // 已入队，等待 worker 拉取
  running    // worker 已拉取，正在执行
  completed  // 正常完成
  failed     // 异常终止
  stopped    // 用户主动停止

  @@map("run_status")
}

model Run {
  id           String    @id @default(uuid()) @db.Uuid
  spiderName   String    @map("spider_name") @db.VarChar(64)
  status       RunStatus @default(queued)
  triggerType  String    @map("trigger_type") @db.VarChar(16)  // "manual" | "cron"
  // 用户在前端可以临时覆盖 spider 默认配置
  overrides    Json?     @default("{}")

  // 统计字段，worker 增量更新
  fetched   Int @default(0)
  emitted   Int @default(0)
  newItems  Int @default(0) @map("new_items")
  errors    Int @default(0)

  startedAt    DateTime? @map("started_at") @db.Timestamp(6)
  finishedAt   DateTime? @map("finished_at") @db.Timestamp(6)
  errorMessage String?   @map("error_message")

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamp(6)

  spider Spider  @relation(fields: [spiderName], references: [name], onDelete: Cascade)
  events Event[]
  items  Item[]

  @@index([status], map: "idx_runs_status")
  @@index([spiderName, createdAt], map: "idx_runs_spider")
  @@map("runs")
}
```

### events

实时日志的持久化。每个事件一行。

```prisma
enum EventLevel {
  debug
  info
  warn
  error

  @@map("event_level")
}

model Event {
  id         Int        @id @default(autoincrement())
  runId      String     @map("run_id") @db.Uuid
  level      EventLevel
  // 事件类型枚举：fetched / emitted / parse_failed / queued / done / ...
  type       String     @db.VarChar(32)
  message    String?
  payload    Json?      @default("{}")
  occurredAt DateTime   @default(now()) @map("occurred_at") @db.Timestamp(6)

  run Run @relation(fields: [runId], references: [id], onDelete: Cascade)

  @@index([runId, occurredAt], map: "idx_events_run_time")
  @@map("events")
}
```

> **注意**：events 表会快速膨胀。生产环境应配 retention（每天清理 7 天前数据）。
> 当前简化处理：在 `src/lib/worker/job-handler.ts` 里只持久化 `info` 及以上级别，`debug` 不入库。

### items

抓取到的内容。

```prisma
model Item {
  id          Int      @id @default(autoincrement())
  runId       String?  @map("run_id") @db.Uuid
  spider      String   @db.VarChar(64)
  type        String   @db.VarChar(32)
  url         String
  urlHash     String   @map("url_hash") @db.Char(40)         // sha1 hex
  contentHash String   @map("content_hash") @db.Char(40)
  payload     Json
  fetchedAt   DateTime @default(now()) @map("fetched_at") @db.Timestamp(6)

  run Run? @relation(fields: [runId], references: [id], onDelete: SetNull)

  @@unique([spider, urlHash, contentHash], map: "uniq_items_spider_url_content")
  @@index([spider, type], map: "idx_items_spider_type")
  @@index([fetchedAt], map: "idx_items_fetched_at")
  @@map("items")
}
```

> 为简化起见 `id` 用 `serial`（int4），单表上限 2.1B 行，对当前规模够用；
> 如果未来某张表确实可能超过这个量级，再升级到 `bigserial` 不晚。

### visited

URL 指纹去重表（独立于 runs，跨 Run 共享）。这样下次抓取同一 URL 会被跳过，实现增量。

```prisma
model Visited {
  spider    String   @db.VarChar(64)
  urlHash   String   @map("url_hash") @db.Char(40)
  url       String
  visitedAt DateTime @default(now()) @map("visited_at") @db.Timestamp(6)

  @@id([spider, urlHash])
  @@map("visited")
}
```

> 用 `(spider, urlHash)` 复合主键。允许同一 URL 在不同 Spider 下被重新访问。

### settings

通用 KV，用来存放代理池、UA 池等不适合做结构化建模的配置。

```prisma
model Setting {
  key       String   @id @db.VarChar(64)
  value     Json
  updatedAt DateTime @default(now()) @map("updated_at") @db.Timestamp(6)

  @@map("settings")
}
```

约定的 key：

| key          | value 形态                                | 说明                      |
| ------------ | ----------------------------------------- | ------------------------- |
| `proxy_pool` | `{ proxies: ProxyEntry[] }`               | 代理列表 + 各自的失败计数 |
| `ua_pool`    | `{ user_agents: string[] }`               | UA 字符串列表             |
| `defaults`   | `{ concurrency, perHostIntervalMs, ... }` | 全局默认 Spider 参数      |

## 索引策略

| 索引                            | 表      | 用途                      |
| ------------------------------- | ------- | ------------------------- |
| `idx_runs_status`               | runs    | 看板首页"当前运行"列表    |
| `idx_runs_spider`               | runs    | Runs 页按 Spider 过滤     |
| `idx_events_run_time`           | events  | 历史日志倒序查询          |
| `uniq_items_spider_url_content` | items   | 去重保证                  |
| `idx_items_spider_type`         | items   | Items 页 Spider/Type 过滤 |
| `idx_items_fetched_at`          | items   | 最近抓取的 Items          |
| `(spider, urlHash) PK`          | visited | 增量去重 lookup           |

## 迁移策略

当前实际运行路径（默认）：

- 业务表由 `src/lib/db/migrate.ts` 中的 `BUSINESS_SCHEMA_SQL` 内联 SQL 创建，
  `runMigrations(databaseUrl)` 包装 `CREATE TABLE IF NOT EXISTS` + 枚举 `DO $$ ... duplicate_object` 守卫，幂等可重入。
- `src/instrumentation.ts` 在 Next.js 进程启动时调一次 `runMigrations()`（单进程，无需分布式锁）。
- 也可以手动跑：`pnpm db:migrate`（实际入口 `scripts/db-migrate.ts`）。
- pg-boss 的队列表由它自己用 `boss.start()` 时按需建出，落在 `pgboss` schema，不归我们管。

可选路径（未来需要严格 schema 演进时启用）：

- `pnpm db:generate` 调 `prisma generate` 刷新 `node_modules/.prisma/client` 类型。
- 切到 `prisma migrate dev` / `prisma migrate deploy` 走标准迁移流——`prisma/migrations/` 下产出 SQL，部署时 `prisma migrate deploy` 应用。
  这一步的代价是要把 `prisma/migrations/` 打进镜像；当前内联 SQL 路径足够轻、还省一个步骤。

## 数据保留与清理

| 数据                    | 保留   | 清理方式                                |
| ----------------------- | ------ | --------------------------------------- |
| events.debug            | 不入库 | 直接过滤                                |
| events.info+            | 7 天   | 定时任务 + cron Spider                  |
| runs (completed/failed) | 30 天  | 同上                                    |
| items                   | 不删   | 用户手动清理                            |
| visited                 | 不删   | 用户手动清理（删 visited 即可强制重抓） |

清理任务用一个内置 Spider `__housekeeping` 实现：每天 03:00 跑一次。

---

## 下一阶段提案：多平台 / 多资源类型扩展（提案中，未实施）

> 配套提案文档见 [`rfcs/0001-multi-platform.md`](../rfcs/0001-multi-platform.md)。
> 下面只列**数据模型层**的增量改动，分 3 个 Phase 落地（详见 [`getting-started/roadmap.md`](../getting-started/roadmap.md)）。
> 现有 schema 不动，所有改动都是"加列 / 加表 / 加索引"，可热迁移。

### 改动总览

| 改动                                   | 影响表    | 落地 Phase |
| -------------------------------------- | --------- | ---------- |
| 加 `platform` / `kind` / `sourceId` 列 | `items`   | Phase 5    |
| 加 `(platform, sourceId)` 唯一索引     | `items`   | Phase 5    |
| 加 `platform` 列                       | `spiders` | Phase 5    |
| 新表 `assets`（媒体文件）              | —         | Phase 7    |
| 新表 `accounts`（凭据）                | —         | Phase 6    |

### items 加列（Phase 5）

```prisma
model Item {
  // ... 现有列
  platform  String @db.VarChar(32)                         // 新增："youtube" / "bilibili" / ...
  kind      String @db.VarChar(16)                         // 新增："video" / "audio" / "image" / "article" / "post" / ...
  sourceId  String @map("source_id") @db.VarChar(128)      // 新增：平台原生 ID，比 url 更稳

  // 现有：uniq_items_spider_url_content / idx_items_spider_type / idx_items_fetched_at 保留以兼容存量数据
  @@unique([platform, sourceId], map: "uniq_items_platform_source")
  @@index([kind, fetchedAt], map: "idx_items_kind")
  @@index([platform, kind], map: "idx_items_platform_kind")
}
```

迁移策略：

1. 先 `ALTER TABLE` 加列，允许 nullable
2. 跑一次 backfill：对存量 `nextjs-blog` 数据写 `platform='nextjs-blog'` / `kind='article'` / `sourceId=urlHash`
3. 加 NOT NULL 约束 + 唯一索引

旧的 `(spider, urlHash, contentHash)` 唯一约束保留，作为"内容变更去重"的旁路。

### spiders 加列（Phase 5）

```prisma
model Spider {
  // ... 现有列
  platform   String? @db.VarChar(32)               // 现有 spider 全部回填为同名 platform
  emitsKinds Json    @default("[]") @map("emits_kinds")  // string[]
}
```

`emitsKinds` 让看板能在 Run 详情按 kind 分桶显示统计。

### assets 表（Phase 7）

```prisma
enum AssetStatus {
  pending      // 入队但还没拉
  downloading
  ready
  failed
  skipped      // 用户配置不下载

  @@map("asset_status")
}

enum AssetKind {
  video
  audio
  image
  thumbnail
  subtitle

  @@map("asset_kind")
}

model Asset {
  id            Int       @id @default(autoincrement())
  itemId        Int       @map("item_id")
  kind          AssetKind

  originalUrl   String    @map("original_url")
  mime          String?   @db.VarChar(64)
  sizeBytes     BigInt?   @map("size_bytes")
  width         Int?
  height        Int?
  durationMs    Int?      @map("duration_ms")
  bitrate       Int?
  lang          String?   @db.VarChar(16)

  storagePath   String?   @map("storage_path")     // "local:/data/assets/..." 或 "s3://bucket/key"
  checksum      String?   @db.Char(64)             // sha256

  status        AssetStatus @default(pending)
  errorMessage  String?     @map("error_message")
  attempts      Int         @default(0)

  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamp(6)
  updatedAt     DateTime  @default(now()) @map("updated_at") @db.Timestamp(6)

  item Item @relation(fields: [itemId], references: [id], onDelete: Cascade)

  @@index([itemId], map: "idx_assets_item")
  @@index([status], map: "idx_assets_status")
  @@index([checksum], map: "idx_assets_checksum") // 跨 item 文件去重
  @@map("assets")
}
```

> 单条 `item` 可以有多个 asset（视频本体 + 缩略图 + 字幕）。
> `download` 队列消费 `status='pending'` 的 asset；写完落 `ready` + 填 `storagePath` + `checksum`。

### accounts 表（Phase 6）

```prisma
enum AccountKind {
  cookie
  oauth
  apikey
  session

  @@map("account_kind")
}

enum AccountStatus {
  active
  expired
  banned
  disabled

  @@map("account_status")
}

model Account {
  id            Int           @id @default(autoincrement())
  platform      String        @db.VarChar(32)
  label         String        @db.VarChar(64)        // 用户自命名
  kind          AccountKind

  // 加密 payload：cookie 串 / OAuth refresh token / api key
  // 加密方式：当前阶段用本地 master key（env: ACCOUNTS_MASTER_KEY），后续阶段升级 KMS
  payloadEnc    String        @map("payload_enc")

  expiresAt     DateTime?     @map("expires_at") @db.Timestamp(6)
  status        AccountStatus @default(active)

  lastUsedAt    DateTime?     @map("last_used_at") @db.Timestamp(6)
  failureCount  Int           @default(0) @map("failure_count")

  createdAt     DateTime      @default(now()) @map("created_at") @db.Timestamp(6)
  updatedAt     DateTime      @default(now()) @map("updated_at") @db.Timestamp(6)

  @@index([platform, status], map: "idx_accounts_platform_status")
  @@unique([platform, label], map: "uniq_accounts_platform_label")
  @@map("accounts")
}
```

### 索引策略增量

| 索引                           | 表       | 用途                                       |
| ------------------------------ | -------- | ------------------------------------------ |
| `uniq_items_platform_source`   | items    | 跨域名 / 跨重定向稳定的去重 key            |
| `idx_items_kind`               | items    | 按资源类型筛选（"看所有视频"）             |
| `idx_items_platform_kind`      | items    | 按平台 + 类型筛选（"YouTube 视频"）        |
| `idx_assets_status`            | assets   | download worker 拉 pending                 |
| `idx_assets_checksum`          | assets   | 同一文件被多次抓时去重                     |
| `idx_accounts_platform_status` | accounts | spider 启动时按 platform 找 active account |

### 数据保留与清理（增量）

| 数据                           | 保留  | 清理方式                                             |
| ------------------------------ | ----- | ---------------------------------------------------- |
| assets (status='ready')        | 不删  | 用户手动 / 触发 GC（看板提供 "释放磁盘" 按钮）       |
| assets (status='failed')       | 30 天 | housekeeping spider 清理                             |
| accounts.payloadEnc            | 不删  | 用户主动管理；过期的 status='expired' 但保留行作历史 |
| accounts (failureCount > 阈值) | 不删  | 自动 status='disabled'；用户在看板复活               |

### 物理存储建议

`assets.storagePath` 解析方案：

- `local:/data/assets/<platform>/<yyyymm>/<sha256>.<ext>` — 本地 FS（dev / 单机默认）
- `s3://<bucket>/<key>` — 对象存储（生产升级，AssetStore 抽象切换实现）

读：API `GET /api/assets/:id/raw` 由 web 进程代理（local FS）或 redirect 签名 URL（S3）。

### 与现有 Phase 1-4 的兼容

- 不删除现有列 / 索引；只做加法
- 旧 spider（如 `nextjs-blog`）按"所有 spider 都需要 platform"原则，回填 `platform = name`
- 现有 API `/api/items` 在 Phase 5 之后多返回 `platform` / `kind` / `sourceId` 字段；前端按需渲染
- 新 API `/api/assets`、`/api/accounts` 在对应 Phase 出现
