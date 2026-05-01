# Reference

hatch-crawler 的"**契约**"——数据库表结构、HTTP/SSE 接口形态、看板页面线框。这些文档是源码层注释引用的"事实来源"（参见 `src/lib/db/schema.ts`、`src/lib/api/response.ts` 顶部注释）。改业务前**先读对应文档**，改完源码同步更新这里，否则两边漂移。

## 索引

| 文档                                     | 内容                                               | 对应代码                                    |
| ---------------------------------------- | -------------------------------------------------- | ------------------------------------------- |
| [data-model.md](./data-model.md)         | Postgres + Prisma 全部表定义、索引、迁移、保留策略 | `prisma/schema.prisma`、`src/lib/db/`       |
| [api-spec.md](./api-spec.md)             | REST 端点 + SSE 通道，含请求/响应示例和错误码      | `src/app/api/**`、`src/lib/api/`            |
| [dashboard-spec.md](./dashboard-spec.md) | 8 个页面的线框、组件清单、用户旅程                 | `src/app/(dashboard)/**`、`src/components/` |

## 维护约定

- **schema 改动**：先改 `data-model.md`（含理由 + 索引 + 迁移说明），同步 `prisma/schema.prisma` 与 `src/lib/db/migrate.ts` 内联 SQL，再 `pnpm db:generate` 刷 Prisma client 类型，最后跑测试。逆序很容易漏字段或忘加索引。
- **API 改动**：先改 `api-spec.md`，再改 `src/lib/api/response.ts` 引用的 Zod schema，最后改路由 handler。`{ ok, data } / { ok: false, error }` 形态是硬约束。
- **看板改动**：`dashboard-spec.md` 是产品/前端协作的中间产物，先在这里画好线框 + 列组件清单 + 描述用户旅程，再开 PR 改 React 组件。

## 上下游

- 想看**整体架构**和**为什么是这套设计** → [`../getting-started/architecture.md`](../getting-started/architecture.md)
- 想看**多平台扩展提案**会怎么改这些表 → [`../rfcs/0001-multi-platform.md`](../rfcs/0001-multi-platform.md)
