/**
 * 资源类型（Resource Kind）Zod schema 体系。
 *
 * 每种 kind 对应一个独立的 Zod schema。
 * Spider 在 emit() 时按 kind 路由到对应 schema 做校验。
 * 前端按 kind 做差异化渲染，不需要 per-platform 分支。
 *
 * 注：每个子文件同时 export const Foo（Zod schema）和 export type Foo（推断类型），
 * 这里只需 re-export 一次，TypeScript 会自动包含 value + type。
 */

import { z } from 'zod';
import { ArticleItem } from './article';
import { VideoItem } from './video';
import { AudioItem } from './audio';
import { ImageItem } from './image';
import { PostItem } from './post';

// 重新导出各 kind 的 schema（value）和推断类型（type）
export { ArticleItem } from './article';
export { VideoItem } from './video';
export { AudioItem } from './audio';
export { ImageItem } from './image';
export { PostItem } from './post';

// 类型别名单独导出，给只关心类型的消费方用
export type { ArticleItem as ArticleItemType } from './article';
export type { VideoItem as VideoItemType } from './video';
export type { AudioItem as AudioItemType } from './audio';
export type { ImageItem as ImageItemType } from './image';
export type { PostItem as PostItemType } from './post';

/** 所有已知 kind 的 discriminated union */
export const ResourceItem = z.discriminatedUnion('kind', [
  ArticleItem,
  VideoItem,
  AudioItem,
  ImageItem,
  PostItem,
]);

export type ResourceItem = z.infer<typeof ResourceItem>;

export const KNOWN_KINDS = ['article', 'video', 'audio', 'image', 'post'] as const;
export type KnownKind = (typeof KNOWN_KINDS)[number];

/** 按 kind 字段路由到对应 Zod schema */
export const KIND_SCHEMAS: Record<KnownKind, z.ZodTypeAny> = {
  article: ArticleItem,
  video: VideoItem,
  audio: AudioItem,
  image: ImageItem,
  post: PostItem,
};
