/**
 * XhsNoteDetailSpider
 *
 * 抓取指定小红书笔记的完整正文、图片列表、标签与互动数据。
 *
 * 必填 params：
 *   - noteIds  : 笔记 ID 列表——JSON 数组字符串、逗号分隔字符串或单个 ID
 *   - cookie   : 从浏览器复制的完整 cookie 字符串（由 job-handler 自动注入）
 *
 * 可选 params：
 *   - delayMs  : 每次请求间隔毫秒数（默认 2000）
 *
 * 接口：POST /api/sns/web/v1/feed
 * 需要 Cookie + X-s/X-t 签名。
 */

import { BaseSpider, type SpiderContext } from '../../../core/spider';
import { ApiClient } from '../../../fetcher/api';
import {
  buildNoteDetailBody,
  buildXhsHeaders,
  NOTE_DETAIL_PATH,
  NOTE_DETAIL_URL,
} from '../helpers';
import type { XhsNoteDetailResponse } from '../parsers';
import { noteDetailToPayload } from '../parsers';
import { logger } from '../../../utils/logger';

// 导入平台注册副作用
import '../index';

export class XhsNoteDetailSpider extends BaseSpider {
  override readonly name = 'xhs-note-detail';
  override readonly maxDepth = 1;

  readonly platform = 'xhs';

  private readonly noteIds: string[];
  private readonly cookie: string;
  private readonly client: ApiClient;

  constructor(params?: Record<string, unknown>) {
    super();
    this.cookie = String(params?.cookie ?? '');

    // noteIds 可以是数组、JSON 字符串、逗号分隔字符串或单个 ID
    const raw = params?.noteIds;
    if (Array.isArray(raw)) {
      this.noteIds = raw.map(String).filter(Boolean);
    } else if (typeof raw === 'string' && raw.trim()) {
      const trimmed = raw.trim();
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          this.noteIds = Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [trimmed];
        } catch {
          this.noteIds = [trimmed];
        }
      } else {
        this.noteIds = trimmed
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } else {
      this.noteIds = [];
    }

    const delayMs = Number(params?.delayMs ?? 2000);
    const proxyUrls = Array.isArray(params?.proxyUrls) ? (params.proxyUrls as string[]) : undefined;
    this.client = new ApiClient({ perRequestDelayMs: delayMs, proxyUrls });
  }

  override get startUrls(): ReadonlyArray<{ url: string; type?: string }> {
    if (this.noteIds.length === 0) {
      logger.warn({ spider: this.name }, 'XhsNoteDetailSpider: noteIds 未设置，startUrls 为空');
      return [];
    }
    return this.noteIds.map((id, i) => ({
      url: `xhs://note-detail?noteId=${encodeURIComponent(id)}`,
      type: `note:${i}`,
    }));
  }

  override async parse(ctx: SpiderContext): Promise<void> {
    const urlObj = new URL(ctx.url);
    const noteId = urlObj.searchParams.get('noteId') ?? '';
    if (!noteId) return;

    const body = buildNoteDetailBody(noteId);
    const headers = buildXhsHeaders(this.cookie, NOTE_DETAIL_PATH, body);

    let resp: XhsNoteDetailResponse;
    try {
      const res = await this.client.post<XhsNoteDetailResponse>(NOTE_DETAIL_URL, body, headers);
      resp = res.data;
    } catch (err) {
      logger.error({ spider: this.name, noteId, err }, 'XhsNoteDetailSpider: 请求失败');
      return;
    }

    if (resp.code !== 0) {
      logger.error(
        { spider: this.name, code: resp.code, noteId },
        'XhsNoteDetailSpider: 接口返回错误（可能需要更新 cookie 或签名）',
      );
      return;
    }

    const items = resp.data?.items ?? [];
    for (const item of items) {
      if (!item.note_card) continue;
      const detail = item.note_card;
      const resolvedId = item.id || noteId;
      const payload = noteDetailToPayload(resolvedId, detail);
      const kind = detail.type === 'video' ? 'video' : 'post';
      ctx.emit({
        url: `https://www.xiaohongshu.com/explore/${resolvedId}`,
        type: kind,
        platform: 'xhs',
        kind,
        sourceId: resolvedId,
        payload,
      });
    }
  }
}
