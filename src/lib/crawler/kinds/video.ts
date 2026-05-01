import { z } from 'zod';

/**
 * 视频类资源：YouTube / B 站 / 抖音 / 小红书视频 …
 *
 * media[] 只记录 URL —— 实际下载走 download 队列（Phase 7）。
 */
export const VideoItem = z.object({
  platform: z.string(),
  kind: z.literal('video'),
  sourceId: z.string(),
  url: z.string().url(),
  title: z.string(),
  description: z.string().optional(),
  author: z
    .object({
      id: z.string(),
      name: z.string(),
      url: z.string().url().optional(),
    })
    .optional(),
  publishedAt: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  metrics: z
    .object({
      views: z.number().int().optional(),
      likes: z.number().int().optional(),
      comments: z.number().int().optional(),
      shares: z.number().int().optional(),
    })
    .optional(),
  /** 媒体文件清单（URL only；下载阶段填充 assets 表） */
  media: z
    .array(
      z.object({
        kind: z.enum(['video', 'audio', 'thumbnail', 'subtitle']),
        url: z.string().url(),
        mime: z.string().optional(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        bitrate: z.number().int().optional(),
        lang: z.string().optional(),
      }),
    )
    .optional(),
  raw: z.record(z.unknown()).optional(),
});

export type VideoItem = z.infer<typeof VideoItem>;
