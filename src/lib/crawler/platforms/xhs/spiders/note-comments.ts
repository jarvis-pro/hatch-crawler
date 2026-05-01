/**
 * XhsNoteCommentsSpider
 *
 * 抓取指定小红书笔记的评论列表（含二级评论）。
 *
 * 必填 params：
 *   - noteId     : 笔记 ID（URL 中 /explore/{noteId}）
 *   - cookie     : 从浏览器复制的完整 cookie 字符串（由 job-handler 自动注入）
 *
 * 可选 params：
 *   - maxPages   : 最多翻页数（默认 20）
 *
 * 接口：GET /api/sns/web/v1/comment/page
 * 需要 Cookie + X-s/X-t 签名。
 */

import { BaseSpider, type SpiderContext } from '../../../core/spider';
import { ApiClient } from '../../../fetcher/api';
import { buildCommentUrl, buildXhsHeaders, COMMENT_PATH } from '../helpers';
import type { XhsCommentPageResponse } from '../parsers';
import { commentToPayload } from '../parsers';
import { logger } from '../../../utils/logger';

// 导入平台注册副作用
import '../index';

export class XhsNoteCommentsSpider extends BaseSpider {
  override readonly name = 'xhs-note-comments';
  override readonly maxDepth = 30;

  readonly platform = 'xhs';

  private readonly noteId: string;
  private readonly maxPages: number;
  private readonly cookie: string;
  private readonly client: ApiClient;

  constructor(params?: Record<string, unknown>) {
    super();
    this.noteId = String(params?.noteId ?? '');
    this.maxPages = Number(params?.maxPages ?? 20);
    this.cookie = String(params?.cookie ?? '');
    const proxyUrls = Array.isArray(params?.proxyUrls) ? (params.proxyUrls as string[]) : undefined;
    this.client = new ApiClient({ perRequestDelayMs: 1500, proxyUrls });
  }

  override get startUrls(): ReadonlyArray<{ url: string; type?: string }> {
    if (!this.noteId) {
      logger.warn({ spider: this.name }, 'XhsNoteCommentsSpider: noteId 未设置，startUrls 为空');
      return [];
    }
    return [
      {
        url: `xhs://note-comments?noteId=${encodeURIComponent(this.noteId)}&cursor=`,
        type: 'page:1',
      },
    ];
  }

  override async parse(ctx: SpiderContext): Promise<void> {
    const { type: jobType } = ctx;
    if (!jobType?.startsWith('page:')) return;
    const pageNum = Number(jobType.split(':')[1] ?? 1);

    const urlObj = new URL(ctx.url);
    const noteId = urlObj.searchParams.get('noteId') ?? this.noteId;
    const cursor = urlObj.searchParams.get('cursor') ?? '';

    const apiUrl = buildCommentUrl({ noteId, cursor });

    // GET 请求；每次单独计算签名
    const signHeaders = buildXhsHeaders(this.cookie, COMMENT_PATH, '');

    let resp: XhsCommentPageResponse;
    try {
      const res = await this.client.get<XhsCommentPageResponse>(apiUrl, undefined, signHeaders);
      resp = res.data;
    } catch (err) {
      logger.error(
        { spider: this.name, noteId, page: pageNum, err },
        'XhsNoteCommentsSpider: 请求失败',
      );
      return;
    }

    if (resp.code !== 0) {
      logger.error(
        { spider: this.name, code: resp.code, noteId },
        'XhsNoteCommentsSpider: 接口返回错误（可能需要更新 cookie 或签名）',
      );
      return;
    }

    const comments = resp.data?.comments ?? [];
    for (const comment of comments) {
      const payload = commentToPayload(comment, noteId);
      ctx.emit({
        url: `https://www.xiaohongshu.com/explore/${noteId}#comment-${comment.id}`,
        type: 'comment',
        platform: 'xhs',
        kind: 'comment',
        sourceId: comment.id,
        payload,
      });
    }

    // 继续翻页
    const hasMore = resp.data?.has_more ?? false;
    const nextCursor = resp.data?.cursor ?? '';
    if (hasMore && comments.length > 0 && pageNum < this.maxPages && nextCursor) {
      ctx.enqueue({
        url: `xhs://note-comments?noteId=${encodeURIComponent(noteId)}&cursor=${encodeURIComponent(nextCursor)}`,
        type: `page:${pageNum + 1}`,
        depth: ctx.depth,
      });
    }
  }
}
