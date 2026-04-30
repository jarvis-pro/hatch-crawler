# 文档索引

hatch-crawler v1 设计文档。**先读完所有文档再开工**，避免实施时方向走偏。

| 文档                                       | 内容                                                  |
| ------------------------------------------ | ----------------------------------------------------- |
| [`architecture.md`](./architecture.md)     | 服务拓扑、模块职责、数据流、关键决策与"不做"清单      |
| [`data-model.md`](./data-model.md)         | Postgres + Drizzle 的所有表定义、索引、迁移与保留策略 |
| [`api-spec.md`](./api-spec.md)             | REST 端点 + SSE 通道，含请求/响应示例                 |
| [`dashboard-spec.md`](./dashboard-spec.md) | 8 个页面的线框、组件清单、用户旅程                    |
| [`roadmap.md`](./roadmap.md)               | 4 个 Phase 的拆解、文件清单与验收标准                 |
| [`deployment.md`](./deployment.md)         | Docker Compose 一键起 + 排错指南                      |

## 阅读顺序

刚加入的同学：

1. `architecture.md` — 先看到全貌
2. `roadmap.md` — 知道我们走到哪一步、下一步要做什么
3. 然后按需要查 `data-model.md` / `api-spec.md` / `dashboard-spec.md`

## 设计原则一览

> 这些原则是写文档的隐含前提，做实施决策时可以回来对照。

- **简单优先**：能轮询就别 WS、能单进程就别分布式
- **类型一致性**：前后端共享同一份 Zod schema
- **可观测**：每个 Run 都有完整事件流，跨进程也能追溯
- **学习友好**：代码结构透明，没有黑魔法
- **可演进**：每层都留好替换接口（Storage / Queue / Spider）

## 当前状态

参考 [`roadmap.md`](./roadmap.md) 末尾的验收清单。
