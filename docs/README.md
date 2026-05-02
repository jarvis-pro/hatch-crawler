# 文档索引

hatch-crawler 设计与运维文档。单仓 Next.js 应用，源码全部在 `src/`，迁移 / worker / 看板共用一个进程。
文档按"读者目的"分四类——

| 目录                                   | 给谁看                     | 包含什么                                                 |
| -------------------------------------- | -------------------------- | -------------------------------------------------------- |
| [getting-started/](./getting-started/) | 第一次接触本项目的人       | 架构总览 + 实施路线，看完拿到全貌                        |
| [reference/](./reference/)             | 改 schema / API / 看板的人 | 数据模型、API 契约、看板规格 —— 源码注释指向的"事实来源" |
| [deploy/](./deploy/)                   | 把项目跑起来的人           | Docker Compose 一键起、关键环境变量、排错指南            |
| [rfcs/](./rfcs/)                       | 做重大架构决策的人         | 落地前写的提案，标"已落地 / 提案中 / 已下线"等状态       |

## 阅读顺序

1. [`getting-started/architecture.md`](./getting-started/architecture.md) — 全貌入口
2. [`getting-started/roadmap.md`](./getting-started/roadmap.md) — 当前进度与下一步
3. 按需查 [`reference/`](./reference/) 下的具体规范

## 当前形态

```
src/
├── app/             Next.js App Router（页面 + /api + /sse）
├── components/      React 组件（ui / nav / runs / items / stats）
├── lib/
│   ├── crawler/     爬虫引擎（core / kinds / platforms / extractors / spiders / ...）
│   ├── db/          Prisma + pg-boss + 业务 repository
│   ├── worker/      进程内 pg-boss worker
│   ├── downloads/   yt-dlp / http 下载工具
│   ├── shared/      跨模块类型（CrawlerEvent 等）
│   ├── api/         API 响应包装
│   └── env.ts       环境变量懒校验
└── instrumentation.ts   启动钩子：跑迁移 + 启动 worker
```

引擎覆盖的平台：YouTube / Bilibili / 小红书 / 微博 / 抖音；
另有跨平台的 `url-extractor` 通过 `/api/extract` 按 URL 列表提取。

## 设计原则

- **简单优先**：能轮询不上 WS，能单进程不上分布式
- **类型一致**：API 入参 / DB jsonb / kind payload 都收紧到 Zod / TS 类型
- **可观测**：每个 Run 全事件流入库 + SSE 实时 + 历史回放
- **学习友好**：代码结构透明，没有黑魔法
- **可演进**：Storage / Spider / Extractor / Platform 每层都留替换接口

## 当前状态

引擎与看板的核心已交付（详见 roadmap）。最近一次大调整：下线了 attachments / 离线下载 / visited 跨 run 去重子系统，下载形态改为"用户在 item 详情页点击 → 后端按需 spawn → 流式回浏览器"。
