import 'server-only';
import { z } from 'zod';
import { extractJobRepo, getBoss, getDb, QUEUE_EXTRACT, type ExtractUrlResult } from '@/lib/db';
import type { ExtractJobData } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, failValidation, ok } from '@/lib/api/response';
import { inspect, type InspectResult } from '@/lib/crawler/extractors/inspect';

/**
 * POST /api/extract
 *
 * 用户提交一批 URL，按 inspect 拆成三类：
 *   - supported   → 落入 extract_jobs.results，下发到 QUEUE_EXTRACT
 *   - unsupported → 进 rejected，原因 'unsupported_host'
 *   - invalid     → 进 rejected，原因 'malformed_url' / 'empty'
 *
 * 与旧版差异：
 *   - 不再创建 runs / 走 url-extractor spider
 *   - 不支持的域名直接拒绝（前端也提前过滤），不再下发执行
 *   - 返回 jobId 替代 runId；前端用 GET /api/extract-jobs/:id 轮询进度
 *
 * 入参：{ urls: string[] }（1..50 条）
 * 返回：{ jobId, accepted, rejected }
 */

const MAX_URLS_PER_REQUEST = 50;

const schema = z.object({
  urls: z
    .array(z.string().min(1))
    .min(1, 'urls 至少 1 条')
    .max(MAX_URLS_PER_REQUEST, `urls 最多 ${MAX_URLS_PER_REQUEST} 条`),
});

interface RejectedEntry {
  url: string;
  reason: 'malformed_url' | 'unsupported_host' | 'duplicate';
  host?: string;
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (body === null) return fail('VALIDATION_ERROR', 'request body must be JSON');

    const parsed = schema.safeParse(body);
    if (!parsed.success) return failValidation(parsed.error);

    // ── 1. 去重 + inspect 分类 ─────────────────────────────────────────────
    const seen = new Set<string>();
    const submittedUrls: string[] = [];
    const rejected: RejectedEntry[] = [];
    const acceptedResults: Record<string, ExtractUrlResult> = {};
    const acceptedQueue: Array<Pick<ExtractJobData, 'originalUrl' | 'canonicalUrl' | 'platform'>> =
      [];

    for (const raw of parsed.data.urls) {
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        rejected.push({ url: raw, reason: 'malformed_url' });
        continue;
      }
      if (seen.has(trimmed)) {
        rejected.push({ url: trimmed, reason: 'duplicate' });
        continue;
      }
      seen.add(trimmed);
      submittedUrls.push(trimmed);

      const r: InspectResult = inspect(trimmed);
      if (r.kind === 'invalid') {
        rejected.push({ url: trimmed, reason: 'malformed_url' });
        continue;
      }
      if (r.kind === 'unsupported') {
        rejected.push({ url: trimmed, reason: 'unsupported_host', host: r.host });
        continue;
      }

      // canonical URL 也要去重——多个不同形态的同一视频应只入队一次
      if (acceptedResults[r.canonicalUrl]) {
        rejected.push({ url: trimmed, reason: 'duplicate' });
        continue;
      }

      acceptedResults[r.canonicalUrl] = {
        originalUrl: trimmed,
        platform: r.platform,
        status: 'pending',
      };
      acceptedQueue.push({
        originalUrl: trimmed,
        canonicalUrl: r.canonicalUrl,
        platform: r.platform,
      });
    }

    if (Object.keys(acceptedResults).length === 0) {
      return fail('VALIDATION_ERROR', '没有任何 URL 命中支持的平台', {
        rejected,
      });
    }

    // ── 2. 创建 extract_job + 批量下发到 pg-boss ───────────────────────────
    const db = getDb(env.databaseUrl);
    const job = await extractJobRepo.create(db, {
      submittedUrls,
      results: acceptedResults,
    });

    const { boss, ready } = getBoss(env.databaseUrl);
    await ready;
    await boss.createQueue(QUEUE_EXTRACT);

    await Promise.all(
      acceptedQueue.map((q) =>
        boss.send(QUEUE_EXTRACT, {
          extractJobId: job.id,
          originalUrl: q.originalUrl,
          canonicalUrl: q.canonicalUrl,
          platform: q.platform,
        } satisfies ExtractJobData),
      ),
    );

    return ok({
      jobId: job.id,
      accepted: acceptedQueue.length,
      rejected,
    });
  } catch (err) {
    return failInternal(err);
  }
}
