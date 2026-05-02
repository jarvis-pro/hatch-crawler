# 数据模型

> hatch-crawler 当前的全部持久化结构。数据库 Postgres 16，ORM Prisma 5。
> pg-boss 在同库的 `pgboss` schema 自管队列表，本文不描述。

## 设计要点

- 业务表共 6 张：`spiders` / `runs` / `events` / `items` / `accounts` / `settings`。
- 大部分配置类字段用 jsonb；在 `src/lib/db/index.ts` 把已知形状收紧成业务类型。
- DDL 写在 `src/lib/db/migrate.ts`（幂等 `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... IF NOT EXISTS`），`prisma/schema.prisma` 是同步的"权威 schema"。改 schema 时两边同步改。
- 索引命名 `idx_<table>_<cols>`，唯一索引 `uniq_<...>`。

## 命名约定

| 维度 | 数据库（snake_case） | 应用层（camelCase） |
| ---- | -------------------- | ------------------- |
| 表名 | `runs`               | `Run`               |
| 列名 | `spider_id`          | `spiderId`          |
| 索引 | `idx_runs_status`    | —                   |
| 唯一 | `uniq_items_...`     | —                   |

Prisma 用 `@map` / `@@map` 处理映射；repository 层进一步把 jsonb 列收紧成业务类型。

## 枚举

```sql
run_status:      queued | running | completed | failed | stopped
event_level:     debug | info | warn | error
account_kind:    cookie | oauth | apikey | session
account_status:  active | expired | banned | disabled
```

---

## `spiders` —— Spider 注册行

> 一行 = 一个 _可启动的 Spider 配置_。`type` 是注册表键（如 `youtube-search`），`name` 是用户自定义显示名（中文友好），可重复。
> `id` UUID 主键 → 同一注册表类型可有多个独立配置实例（不同 cron / overrides）。

| 列                          | 类型         | 说明                                                                                  |
| --------------------------- | ------------ | ------------------------------------------------------------------------------------- |
| `id`                        | uuid PK      | `gen_random_uuid()`                                                                   |
| `name`                      | varchar(128) | 用户自定义显示名（中文 OK），可重复                                                   |
| `type`                      | varchar(64)  | 注册表类型键，对应 `SPIDER_REGISTRY[type]`                                            |
| `description`               | text?        | 备注                                                                                  |
| `start_urls`                | jsonb        | `string[]`，可空（API-based spider 在 factory 里动态构造）                            |
| `allowed_hosts`             | jsonb        | `string[]`                                                                            |
| `max_depth`                 | int          | 默认 2                                                                                |
| `concurrency`               | int          | 默认 4                                                                                |
| `per_host_interval_ms`      | int          | 默认 500                                                                              |
| `enabled`                   | bool         | 默认 true；`false` 时无法手动启动 + 自动停用机制把它改为 false                        |
| `cron_schedule`             | varchar(64)? | pg-boss cron 表达式；写入时 `syncSpiderSchedule` 同步到 pg-boss schedule              |
| `platform`                  | varchar(32)? | 与 `accounts.platform` / `items.platform` 对齐（用于自动注入凭据）                    |
| `emits_kinds`               | jsonb        | `string[]`，目前作展示用                                                              |
| `default_params`            | jsonb        | Spider 构造参数默认值（如 `{ channelId, query }`），被 `overrides` 覆盖               |
| `consecutive_failures`      | int          | 连续失败计数；超阈值（settings.max_consecutive_failures，默认 3）自动 `enabled=false` |
| `display_name`              | varchar(128) | 历史遗留列，DEFAULT ''；新代码不用                                                    |
| `spider_type`               | varchar(64)  | 历史遗留列，DEFAULT ''；新代码不用                                                    |
| `created_at` / `updated_at` | timestamp    | —                                                                                     |

索引：主键 `id` 即可（`type` / `name` 都可重复）。

> 历史迁移留痕：旧库以 `name` 为 PK，迁移到 UUID PK 后保留了 `display_name` / `spider_type` 两列做向后兼容；`migrate.ts` 的 ALTER 段保证从旧库无缝升级，新代码读取走 `id` / `name` / `type`。

---

## `runs` —— 单次抓取实例

| 列              | 类型         | 说明                                                        |
| --------------- | ------------ | ----------------------------------------------------------- |
| `id`            | uuid PK      | `gen_random_uuid()`                                         |
| `spider_id`     | uuid FK?     | → `spiders.id`，`ON DELETE CASCADE`；nullable 兼容历史数据  |
| `spider_name`   | varchar(128) | 冗余 spider.name，便于查询/展示                             |
| `status`        | run_status   | `queued` → `running` → `completed`/`failed`/`stopped`       |
| `trigger_type`  | varchar(16)  | `manual` / `cron`                                           |
| `overrides`     | jsonb        | 本次 run 的 spider 构造参数覆盖（含 url-extractor 的 urls） |
| `fetched`       | int          | 增量统计：成功 fetch 的页数                                 |
| `emitted`       | int          | item 累积数（含重复）                                       |
| `new_items`     | int          | 新增 item 数（去重后）                                      |
| `errors`        | int          | error 级事件计数                                            |
| `started_at`    | timestamp?   | markStarted                                                 |
| `finished_at`   | timestamp?   | markFinished                                                |
| `error_message` | text?        | failed 时的错误概要                                         |
| `created_at`    | timestamp    | —                                                           |

索引：`idx_runs_status`、`idx_runs_spider (spider_name, created_at)`、`idx_runs_spider_id`。

---

## `events` —— Run 的持久化事件流

> 与 EventBus 互补：EventBus 推 SSE（实时），事件同步落 events 表（持久化）。
> `level=debug` 不入库（只走 EventBus）。

| 列            | 类型        | 说明                                                                             |
| ------------- | ----------- | -------------------------------------------------------------------------------- |
| `id`          | serial PK   | —                                                                                |
| `run_id`      | uuid FK     | → `runs.id`，`ON DELETE CASCADE`                                                 |
| `level`       | event_level | `debug` / `info` / `warn` / `error`                                              |
| `type`        | varchar(32) | `fetched` / `queued` / `skipped` / `emitted` / `fetch_failed` / `error` / `done` |
| `message`     | text?       | 由 `extractMessage(event)` 生成                                                  |
| `payload`     | jsonb       | type/level/at 之外的字段                                                         |
| `occurred_at` | timestamp   | 默认 `now()`                                                                     |

索引：`idx_events_run_time (run_id, occurred_at)`。

---

## `items` —— 抓取产物

> 一行 = 一个抓到的内容对象（视频元数据 / 帖子 / 文章……）。
> 跨平台统一用 `platform` + `kind` + `source_id` 三元组定位。

| 列             | 类型          | 说明                                                                |
| -------------- | ------------- | ------------------------------------------------------------------- |
| `id`           | serial PK     | —                                                                   |
| `run_id`       | uuid FK?      | → `runs.id`，`ON DELETE SET NULL`                                   |
| `spider`       | varchar(64)   | spider.name 冗余                                                    |
| `type`         | varchar(32)   | spider 内部分类，如 `extract` / `search-result`（与 kind 不同维度） |
| `url`          | text          | canonical URL                                                       |
| `url_hash`     | char(40)      | sha1(url)                                                           |
| `content_hash` | char(40)      | sha1(JSON.stringify(payload))                                       |
| `payload`      | jsonb         | kind 对应的 schema（`src/lib/crawler/kinds/*`）                     |
| `platform`     | varchar(32)?  | `youtube` / `bilibili` / `xhs` / `weibo` / `douyin` / null          |
| `kind`         | varchar(16)?  | `article` / `video` / `audio` / `image` / `post` / null             |
| `source_id`    | varchar(128)? | 平台内唯一 ID（如 YouTube videoId）                                 |
| `fetched_at`   | timestamp     | —                                                                   |

索引：

- 唯一：`uniq_items_spider_url_content (spider, url_hash, content_hash)` — 兜底去重
- 唯一（部分）：`uniq_items_platform_source (platform, source_id) WHERE platform IS NOT NULL AND source_id IS NOT NULL` — 跨 spider/run 同一来源仅一行
- `idx_items_spider_type` / `idx_items_fetched_at` / `idx_items_kind` / `idx_items_platform`

### 去重策略

`itemRepo.save()` 双层：

1. `(platform, source_id)` 双非空 → upsert，命中则更新 payload，`isNew=false`
2. 其余情况 → 写入；冲突 `(spider, url_hash, content_hash)` 时 `isNew=false`

`isNew=true` 触发 `runs.new_items += 1`。

### kind payload schema

每个 kind 在 `src/lib/crawler/kinds/<kind>.ts` 定义独立 Zod schema。`PostgresStorage` 写入时做软校验（失败 warn 不阻断）。`VideoItem` 含 `videoFormats`（yt-dlp `--dump-json` 解析的可下载分辨率/大小，可空），看板下载菜单优先按它生成选项。

---

## `accounts` —— 平台凭据（加密）

> AES-256-GCM 加密 payload；主密钥从 `ACCOUNTS_MASTER_KEY` 读取。

| 列                          | 类型           | 说明                                         |
| --------------------------- | -------------- | -------------------------------------------- |
| `id`                        | serial PK      | —                                            |
| `platform`                  | varchar(32)    | `youtube` / `bilibili` / ...                 |
| `label`                     | varchar(64)    | 用户备注（"alt 账号"等）                     |
| `kind`                      | account_kind   | `cookie` / `oauth` / `apikey` / `session`    |
| `payload_enc`               | text           | hex 编码 `iv(12B) + tag(16B) + ciphertext`   |
| `expires_at`                | timestamp?     | 仅 OAuth 用                                  |
| `status`                    | account_status | `active` / `expired` / `banned` / `disabled` |
| `last_used_at`              | timestamp?     | 每次注入时更新                               |
| `failure_count`             | int            | 连续失败计数；≥ 5 自动 `banned`              |
| `last_tested_at`            | timestamp?     | `/test` 端点更新                             |
| `last_test_ok`              | bool?          | 同上                                         |
| `quota_used_today`          | int            | 当天配额消耗（YouTube apikey 测试自动记录）  |
| `quota_reset_at`            | date           | 配额重置基准日                               |
| `created_at` / `updated_at` | timestamp      | —                                            |

索引：`idx_accounts_platform_status (platform, status)`。

### 加密格式

```
hex( iv [12B] || authTag [16B] || ciphertext )
```

主密钥未配置时 fallback 全零（仅 dev）；非法格式启动直接抛错。`encrypt` / `decrypt` 暴露在 `repositories/accounts.ts`。

### 读取规则

`accountRepo.getActiveAccount(db, platform, kind, masterKey)`：

```sql
SELECT * FROM accounts
WHERE platform = $1 AND kind = $2 AND status = 'active'
ORDER BY failure_count ASC, last_used_at NULLS FIRST
LIMIT 1
```

返回值会更新 `last_used_at`，并解密 payload 后挂入 spider 构造参数（`apiKey` / `cookie`）。

---

## `settings` —— 通用 KV 配置

| 列           | 类型           |
| ------------ | -------------- |
| `key`        | varchar(64) PK |
| `value`      | jsonb          |
| `updated_at` | timestamp      |

### 已知 key

| key                        | value 形状                                                                      | 用途                             |
| -------------------------- | ------------------------------------------------------------------------------- | -------------------------------- |
| `defaults`                 | `{ concurrency, perHostIntervalMs, requestTimeoutMs, retryAttempts, logLevel }` | 全局默认值                       |
| `ua_pool`                  | `{ user_agents: string[] }`                                                     | 中间件随机 User-Agent            |
| `proxy_pool`               | `string[]`（直接列表）或 `{ proxies: string[] }`                                | 代理列表；worker 会注入到 spider |
| `webhook_url`              | string                                                                          | run 完成时 POST 通知的目标 URL   |
| `max_consecutive_failures` | number                                                                          | spider 自动停用阈值（默认 3）    |

> 注意：`proxy_pool` 历史上既有 "纯数组" 也有 `{ proxies }` 形态，job-handler 取数组当成生效列表，新写入推荐纯数组。

---

## pg-boss schema

`pgboss.*` 由 `boss.start()` 自动建/迁，业务侧 _不要_ 手工 `INSERT`。常用队列：

| 队列名                  | 触发                          | 数据形状                                               |
| ----------------------- | ----------------------------- | ------------------------------------------------------ |
| `crawl`                 | 手动 / cron                   | `{ runId: uuid, spiderId: uuid, overrides? }`          |
| `crawl-cron:<spiderId>` | spider.cron_schedule 同步注册 | `{ spiderId: uuid }`，命中后产出 trigger=`cron` 的 run |

cron schedule 与 spider 的 enable/cron_schedule 同步逻辑见 `src/lib/worker/index.ts#syncSpiderSchedule`。

---

## 改 schema 的标准动作

1. 改 `prisma/schema.prisma`
2. 同步把 ALTER/CREATE 加到 `src/lib/db/migrate.ts`（幂等！）
3. 如有 jsonb 形状变化，更新 `src/lib/db/index.ts` 的业务类型
4. `pnpm db:generate` 刷 Prisma client
5. 改对应 repository
6. `pnpm check` 全绿

> 严格演进（多人/生产）时再切到 `prisma migrate dev/deploy`，目前还没切。
