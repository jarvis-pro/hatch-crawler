import 'server-only';
import { z } from 'zod';
import { ensureBuiltinSpiders, getBoss, getDb, QUEUE_CRAWL, runRepo, spiderRepo } from '@/lib/db';
import { env } from '@/lib/env';
import { fail, failInternal, failValidation, ok } from '@/lib/api/response';

/**
 * POST /api/extract
 *
 * 按用户提交的 URL 列表创建一次"按链接抓取"运行。
 * 内部走 url-extractor spider —— 一个 run 对应一批 URL，每条 URL 产出一条 video item。
 *
 * 入参：{ urls: string[] }（1..50 条）
 * 返回：{ runId, accepted, rejected }
 *   - rejected 包含本批中"格式非法（new URL 抛错）"的字符串；这些不进 run。
 *   - "格式合法但 host 不被支持" 的 URL 仍然会进 run，由 spider 在 parse 阶段
 *     ctx.log error 跳过，便于用户从 events 表回溯。
 *
 * 进度：前端订阅 /sse/runs/:runId/logs 实时看；
 * 结果：跑完后 GET /api/items?runId=:runId。
 */

const MAX_URLS_PER_REQUEST = 50;

const schema = z.object({
  urls: z
    .array(z.string().min(1))
    .min(1, 'urls 至少 1 条')
    .max(MAX_URLS_PER_REQUEST, `urls 最多 ${MAX_URLS_PER_REQUEST} 条`),
});

function isParseableUrl(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    if (body === null) return fail('VALIDATION_ERROR', 'request body must be JSON');

    const parsed = schema.safeParse(body);
    if (!parsed.success) return failValidation(parsed.error);

    // trim + 去重，保持原顺序
    const seen = new Set<string>();
    const trimmed = parsed.data.urls
      .map((u) => u.trim())
      .filter((u) => {
        if (u.length === 0 || seen.has(u)) return false;
        seen.add(u);
        return true;
      });

    const accepted: string[] = [];
    const rejected: string[] = [];
    for (const u of trimmed) {
      (isParseableUrl(u) ? accepted : rejected).push(u);
    }

    if (accepted.length === 0) {
      return fail('VALIDATION_ERROR', '所有 URL 格式都无法解析', { rejected });
    }

    const db = getDb(env.databaseUrl);

    // ensureBuiltinSpiders 在 instrumentation 启动时已执行，但本地开发首次访问
    // 偶尔早于 instrumentation；保险起见再幂等执行一次（命中存在则零写入）。
    await ensureBuiltinSpiders(db);
    const spider = await spiderRepo.getByType(db, 'url-extractor');
    if (!spider) {
      return fail('INTERNAL_ERROR', 'url-extractor spider 未初始化（请重启服务）');
    }
    if (!spider.enabled) return fail('CONFLICT', 'url-extractor 当前为停用状态');

    const overrides: Record<string, unknown> = { urls: accepted };

    const run = await runRepo.create(db, {
      spiderId: spider.id,
      spiderName: spider.name,
      triggerType: 'manual',
      overrides,
    });

    const { boss, ready } = getBoss(env.databaseUrl);
    await ready;
    await boss.send(QUEUE_CRAWL, {
      runId: run.id,
      spiderId: spider.id,
      overrides,
    });

    return ok({
      runId: run.id,
      accepted: accepted.length,
      rejected,
    });
  } catch (err) {
    return failInternal(err);
  }
}
