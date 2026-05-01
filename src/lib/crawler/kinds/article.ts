import { z } from 'zod';

/**
 * 文章类资源：博客 / 公众号文章 / 长文
 */
export const ArticleItem = z.object({
  platform: z.string(),
  kind: z.literal('article'),
  sourceId: z.string(),
  url: z.string().url(),
  title: z.string(),
  description: z.string().optional(),
  author: z
    .object({
      id: z.string().optional(),
      name: z.string(),
      url: z.string().url().optional(),
    })
    .optional(),
  publishedAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
  content: z.string().optional(),
  wordCount: z.number().int().nonnegative().optional(),
  raw: z.record(z.unknown()).optional(),
});

export type ArticleItem = z.infer<typeof ArticleItem>;
