/**
 * XhsUserNotesSpider
 *
 * 抓取指定小红书用户的所有公开笔记。
 *
 * 必填 params：
 *   - userId     : 用户主页 ID（URL 中 /user/profile/{userId}）
 *   - cookie     : 从浏览器复制的完整 cookie 字符串（由 job-handler 自动注入）
 *
 * 可选 params：
 *   - maxPages   : 最多翻页数（默认 10）
 *   - pageSize   : 每次请求返回条数（默认 18，接口限制 18）
 *
 * 接口：GET /api/sns/web/v1/user/posted
 * 需要 Cookie + X-s/X-t 签名。
 */

import { BaseSpider, type SpiderContext } from '../../../core/spider';
import { ApiClient } from '../../../fetcher/api';
import { buildUserNotesUrl, buildXhsHeaders, USER_NOTES_PATH } from '../helpers';
import type { XhsUserNotesResponse } from '../parsers';
import { userNoteToPayload } from '../parsers';
import { logger } from '../../../utils/logger';

// 导入平台注册副作用
import '../index';

export class XhsUserNotesSpider extends BaseSpider {
  override readonly name = 'xhs-user-notes';
  override readonly maxDepth = 30;

  readonly platform = 'xhs';

  private readonly userId: string;
  private readonly maxPages: number;
  private readonly pageSize: number;
  private readonly cookie: string;

  private readonly client: ApiClient;

  constructor(params?: Record<string, unknown>) {
    super();
    this.userId = String(params?.userId ?? '');
    this.maxPages = Number(params?.maxPages ?? 10);
    this.pageSize = Math.min(Number(params?.pageSize ?? 18), 18);
    this.cookie = String(params?.cookie ?? '');
    // 签名（含 cookie）在 parse() 里每次请求单独计算后通过 extraHeaders 传入
    this.client = new ApiClient({ perRequestDelayMs: 1500 });
  }

  override get startUrls(): ReadonlyArray<{ url: string; type?: string }> {
    if (!this.userId) {
      logger.warn({ spider: this.name }, 'XhsUserNotesSpider: userId 未设置，startUrls 为空');
      return [];
    }
    return [
      {
        url: `xhs://user-notes?userId=${this.userId}&cursor=`,
        type: 'page:1',
      },
    ];
  }

  override async parse(ctx: SpiderContext): Promise<void> {
    const { type: jobType } = ctx;
    if (!jobType?.startsWith('page:')) return;
    const pageNum = Number(jobType.split(':')[1] ?? 1);

    // 从 URL 中解析 cursor
    const urlObj = new URL(ctx.url);
    const cursor = urlObj.searchParams.get('cursor') ?? '';

    const apiUrl = buildUserNotesUrl({
      userId: this.userId,
      cursor,
      pageSize: this.pageSize,
    });

    // GET 请求 body 为空字符串；每次请求重新计算签名（X-t 含时间戳）
    const signHeaders = buildXhsHeaders(this.cookie, USER_NOTES_PATH, '');

    let resp: XhsUserNotesResponse;
    try {
      const res = await this.client.get<XhsUserNotesResponse>(apiUrl, undefined, signHeaders);
      resp = res.data;
    } catch (err) {
      logger.error({ spider: this.name, page: pageNum, err }, 'XhsUserNotesSpider: 请求失败');
      return;
    }

    if (resp.code !== 0) {
      logger.error(
        { spider: this.name, code: resp.code },
        'XhsUserNotesSpider: 接口返回错误（可能需要更新 cookie 或签名）',
      );
      return;
    }

    const notes = resp.data?.notes ?? [];
    for (const note of notes) {
      const payload = userNoteToPayload(note);
      const kind = note.type === 'video' ? 'video' : 'post';
      ctx.emit({
        url: `https://www.xiaohongshu.com/explore/${note.note_id}`,
        type: kind,
        platform: 'xhs',
        kind,
        sourceId: note.note_id,
        payload,
      });
    }

    // 继续翻页（使用 cursor 分页）
    const hasMore = resp.data?.has_more ?? false;
    const nextCursor = resp.data?.cursor ?? '';
    if (hasMore && notes.length > 0 && pageNum < this.maxPages && nextCursor) {
      ctx.enqueue({
        url: `xhs://user-notes?userId=${this.userId}&cursor=${encodeURIComponent(nextCursor)}`,
        type: `page:${pageNum + 1}`,
        depth: ctx.depth,
      });
    }
  }
}
