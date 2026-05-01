# 文档索引

hatch-crawler 设计 / 运维文档。整体架构已落地为单仓 Next.js 应用（无 monorepo），所有源码集中在 `src/`，迁移、worker 与看板共用一个进程。文档按"读者目的"分四类组织——

| 目录                                   | 给谁看                       | 包含什么                                                 |
| -------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| [getting-started/](./getting-started/) | 第一次接触本项目的同学       | 架构总览 + 实施路线，看完拿到全貌                        |
| [reference/](./reference/)             | 改 schema / API / 看板的同学 | 数据模型、API 契约、看板线框——源码注释指向的"事实来源"   |
| [deploy/](./deploy/)                   | 把它跑起来的同学             | Docker Compose 一键起、关键环境变量、排错指南            |
| [rfcs/](./rfcs/)                       | 做重大架构决策的同学         | 落地前写的提案（含状态字段），目前有 RFC 0001 多平台扩展 |

## 阅读顺序

刚加入的同学：

1. [`getting-started/architecture.md`](./getting-started/architecture.md) — 先看到全貌
2. [`getting-started/roadmap.md`](./getting-started/roadmap.md) — 知道当前进度（Phase 1-4 已完成）和下一步
3. 然后按需要查 [`reference/`](./reference/) 下的具体规范

## 当前结构（一句话版）

```
src/
├── app/            Next.js App Router（页面 + /api + /sse）
├── components/     React 组件（ui / nav / runs / items / stats）
├── lib/            crawler 引擎 + db + worker + shared 类型
└── instrumentation.ts   进程启动钩子（迁移 + worker）
```

详细说明在 [`getting-started/architecture.md`](./getting-started/architecture.md)。

## 设计原则一览

> 这些原则是写文档的隐含前提，做实施决策时可以回来对照。

- **简单优先**：能轮询就别 WS、能单进程就别分布式
- **类型一致性**：前后端共享同一份 Zod schema
- **可观测**：每个 Run 都有完整事件流，跨进程也能追溯
- **学习友好**：代码结构透明，没有黑魔法
- **可演进**：每层都留好替换接口（Storage / Queue / Spider）

## 当前状态

Phase 1-4 已全部交付，详见 [`getting-started/roadmap.md`](./getting-started/roadmap.md) 末尾的当前验收清单。

下一阶段正在提案中：把单平台 / 单资源类型扩展为支持多平台（YouTube / B 站 / 小红书 / 抖音 …）× 多资源类型（视频 / 音频 / 图片 / 文章 / 短贴 …）。提案文档为 [`rfcs/0001-multi-platform.md`](./rfcs/0001-multi-platform.md)，配套的数据模型与架构增量小节都标了"提案中、未实施"，落地路径在 [`getting-started/roadmap.md`](./getting-started/roadmap.md) 的 Phase 5 / 6 / 7。
