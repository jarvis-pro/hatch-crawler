import { z } from 'zod';

/**
 * 短帖类资源：微博 / 推文 / 小红书笔记 / 知乎回答
 */
export const PostItem = z.object({
  platform: z.string(),
  kind: z.literal('post'),
  sourceId: z.string(),
  url: z.string().url(),
  content: z.string(),
  author: z
    .object({
      id: z.string(),
      name: z.string(),
      url: z.string().url().optional(),
    })
    .optional(),
  publishedAt: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
  metrics: z
    .object({
      views: z.number().int().optional(),
      likes: z.number().int().optional(),
      comments: z.number().int().optional(),
      reposts: z.number().int().optional(),
    })
    .optional(),
  media: z
    .array(
      z.object({
        kind: z.enum(['image', 'video', 'audio']),
        url: z.string().url(),
        mime: z.string().optional(),
      }),
    )
    .optional(),
  raw: z.record(z.unknown()).optional(),
});

export type PostItem = z.infer<typeof PostItem>;
