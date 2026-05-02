import 'server-only';
import { type Db, extractJobRepo, itemRepo, settingRepo, SETTINGS_KEYS } from '@/lib/db';
import type { ExtractJobData } from '@/lib/db';
import { Fetcher, setCrawlerConfig, type SpiderContext } from '@/lib/crawler';
import { extractorRegistry, ExtractorError } from '@/lib/crawler/extractors/registry';
import type { VideoMetadata } from '@/lib/crawler/extractors/types';

/**
 * 单条 extract URL 的处理函数。
 *
 * 与 crawl handler 的差异：
 *  - 不写 runs / events 表
 *  - 不计入 spider 的 consecutive_failures（extract 失败多源于用户输入）
 *  - 进度直接落到 extract_jobs.results jsonb + 计数器
 *
 * pg-boss 自带的重试机制对网络抖动友好；ExtractorError（业务错误）
 * 我们自行捕获后归类为 succeeded=false，不再 rethrow（避免 pg-boss 重试用户输入问题）。
 *
 * 约定：永远不抛出 → pg-boss 永远把 job 视为 done，避免被卡在重试。
 * 真出现意料之外的 fatal 错（如 DB 连不上）则尽力 recordOutcome=failed 后吞掉。
 */
export async function handleExtractJob(db: Db, data: ExtractJobData): Promise<void> {
  const { extractJobId, originalUrl, canonicalUrl, platform } = data;

  // 1) 找到对应的 extractor。platform 在入队前已由 inspect 计算，命中 extractorRegistry.name
  const extractor = extractorRegistry.find((e) => e.name === platform);
  if (!extractor) {
    await safeRecordFailed(db, extractJobId, canonicalUrl, {
      errorCode: 'NOT_SUPPORTED',
      errorMessage: `平台 ${platform} 在 extractor 注册表中已不存在`,
    });
    return;
  }

  // 2) 应用全局代理池（与 crawl 链路保持一致：都从 settings.proxy_pool 读）
  //    setCrawlerConfig 是合并语义，重复调用安全
  try {
    const proxyList = await settingRepo
      .get<string[]>(db, SETTINGS_KEYS.proxyPool)
      .catch(() => null);
    if (Array.isArray(proxyList) && proxyList.length > 0) {
      setCrawlerConfig({ proxyList });
    }
  } catch {
    // 配置读不到不影响主流程
  }

  // 3) 抓取页面
  let html: string;
  let finalUrl: string;
  let status: number;
  try {
    const fetcher = new Fetcher();
    const result = await fetcher.fetch(canonicalUrl);
    html = result.body;
    finalUrl = result.finalUrl;
    status = result.status;
    if (status >= 400) {
      await safeRecordFailed(db, extractJobId, canonicalUrl, {
        errorCode: 'NETWORK_ERROR',
        errorMessage: `HTTP ${status}`,
      });
      return;
    }
  } catch (err) {
    await safeRecordFailed(db, extractJobId, canonicalUrl, {
      errorCode: 'NETWORK_ERROR',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // 4) 构造最小 SpiderContext —— extractor.extract 只读 ctx.url / ctx.response.body，
  //    其余成员（emit/enqueue/log）在 extract 路径不会被调用，置为 noop。
  const ctx: SpiderContext = {
    url: canonicalUrl,
    type: 'extract',
    meta: {},
    depth: 0,
    response: {
      url: canonicalUrl,
      finalUrl,
      status,
      body: html,
      headers: {},
    },
    enqueue: () => {},
    emit: () => {},
    log: () => {},
  };

  // 5) 解析
  let metadata: VideoMetadata;
  try {
    metadata = await extractor.extract(ctx);
  } catch (err) {
    if (err instanceof ExtractorError) {
      await safeRecordFailed(db, extractJobId, canonicalUrl, {
        errorCode: err.code,
        errorMessage: err.message,
      });
      return;
    }
    await safeRecordFailed(db, extractJobId, canonicalUrl, {
      errorCode: 'PARSE_FAILED',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // 6) 持久化 item（runId=null；extractJobId 回填；triggerKind='extract'）
  try {
    const result = await saveExtractedItem(db, extractJobId, originalUrl, metadata);
    await extractJobRepo.recordOutcome(db, {
      jobId: extractJobId,
      canonicalUrl,
      outcome: { kind: 'succeeded', itemId: result.itemId },
    });
  } catch (err) {
    await safeRecordFailed(db, extractJobId, canonicalUrl, {
      errorCode: 'INTERNAL_ERROR',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}

async function safeRecordFailed(
  db: Db,
  jobId: string,
  canonicalUrl: string,
  reason: { errorCode: string; errorMessage: string },
): Promise<void> {
  try {
    await extractJobRepo.recordOutcome(db, {
      jobId,
      canonicalUrl,
      outcome: { kind: 'failed', errorCode: reason.errorCode, errorMessage: reason.errorMessage },
    });
  } catch (err) {
    // 数据库都写不进的极端情况，至少 log 一下
    console.warn('[extract-handler] recordOutcome failed:', err);
  }
}

/**
 * 把 extractor 输出的 VideoMetadata 转成 NewItem 形态写库。
 *
 * extract 路径上 platform+sourceId 必填，itemRepo.save 走 upsert 分支
 * （ON CONFLICT DO UPDATE ... RETURNING id），id 一定有；若拿不到说明库出问题。
 */
async function saveExtractedItem(
  db: Db,
  extractJobId: string,
  _originalUrl: string,
  metadata: VideoMetadata,
): Promise<{ itemId: number; isNew: boolean }> {
  const { isNew, id } = await itemRepo.save(db, {
    runId: null,
    spider: 'extract',
    type: 'video',
    url: metadata.url,
    payload: metadata as unknown as Record<string, unknown>,
    platform: metadata.platform,
    kind: metadata.kind,
    sourceId: metadata.sourceId,
    triggerKind: 'extract',
    taskId: null,
    extractJobId,
  });

  if (id === undefined) {
    throw new Error('extracted item saved but no id returned');
  }
  return { itemId: id, isNew };
}
