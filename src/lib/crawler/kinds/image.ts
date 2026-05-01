import { z } from 'zod';

/**
 * 图片类资源：图集 / 单图 / 小红书图文
 */
export const ImageItem = z.object({
  platform: z.string(),
  kind: z.literal('image'),
  sourceId: z.string(),
  url: z.string().url(),
  title: z.string().optional(),
  description: z.string().optional(),
  author: z
    .object({
      id: z.string().optional(),
      name: z.string(),
      url: z.string().url().optional(),
    })
    .optional(),
  publishedAt: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
  media: z
    .array(
      z.object({
        kind: z.literal('image'),
        url: z.string().url(),
        mime: z.string().optional(),
        width: z.number().int().optional(),
        height: z.number().int().optional(),
        alt: z.string().optional(),
      }),
    )
    .optional(),
  raw: z.record(z.unknown()).optional(),
});

export type ImageItem = z.infer<typeof ImageItem>;
