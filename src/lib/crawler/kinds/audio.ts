import { z } from 'zod';

/**
 * 音频类资源：播客 / 单曲 / 有声书
 */
export const AudioItem = z.object({
  platform: z.string(),
  kind: z.literal('audio'),
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
  tags: z.array(z.string()).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  episodeNumber: z.number().int().optional(),
  seriesId: z.string().optional(),
  seriesTitle: z.string().optional(),
  media: z
    .array(
      z.object({
        kind: z.enum(['audio', 'image']),
        url: z.string().url(),
        mime: z.string().optional(),
        bitrate: z.number().int().optional(),
        lang: z.string().optional(),
      }),
    )
    .optional(),
  raw: z.record(z.unknown()).optional(),
});

export type AudioItem = z.infer<typeof AudioItem>;
