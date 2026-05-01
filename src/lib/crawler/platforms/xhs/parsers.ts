/**
 * 小红书 API 响应类型定义及 payload 映射工具。
 *
 * 接口均为非官方，基于逆向观察整理。
 */

import { parseCount } from './helpers';

// ── 通用 ──────────────────────────────────────────────────────────────────────

export interface XhsCover {
  url: string;
  width?: number;
  height?: number;
}

export interface XhsUser {
  userid?: string;
  user_id?: string;
  nickname: string;
  avatar?: string;
}

export interface XhsInteractInfo {
  liked_count?: string | number;
  comment_count?: string | number;
  share_count?: string | number;
  collected_count?: string | number;
}

// ── 搜索接口 POST /api/sns/web/v1/search/notes ────────────────────────────────

export interface XhsSearchNoteCard {
  type: 'normal' | 'video';
  display_title: string;
  cover?: XhsCover;
  user?: XhsUser;
  interact_info?: XhsInteractInfo;
  /** 部分接口版本会直接给出发布时间（秒级 Unix 时间戳） */
  time?: number;
}

export interface XhsSearchItem {
  id: string;
  model_type: string;
  note_card?: XhsSearchNoteCard;
}

export interface XhsSearchResponse {
  code: number;
  success?: boolean;
  msg?: string;
  data?: {
    items?: XhsSearchItem[];
    has_more?: boolean;
    cursor?: string;
  };
}

// ── 用户笔记接口 GET /api/sns/web/v1/user/posted ──────────────────────────────

export interface XhsUserNote {
  note_id: string;
  type: 'normal' | 'video';
  display_title?: string;
  cover?: XhsCover;
  interact_info?: XhsInteractInfo;
  time?: number;
}

export interface XhsUserNotesResponse {
  code: number;
  success?: boolean;
  data?: {
    notes?: XhsUserNote[];
    has_more?: boolean;
    cursor?: string;
  };
}

// ── Payload 映射 ──────────────────────────────────────────────────────────────

/**
 * 将搜索结果 note_card 转换为标准 payload。
 * type=normal → kind=post；type=video → kind=video。
 */
export function searchNoteToPayload(
  noteId: string,
  card: XhsSearchNoteCard,
): Record<string, unknown> {
  const kind = card.type === 'video' ? 'video' : 'post';
  const coverUrl = card.cover?.url ?? null;

  return {
    title: card.display_title,
    kind,
    author: card.user
      ? {
          id: card.user.userid ?? card.user.user_id,
          name: card.user.nickname,
          avatar: card.user.avatar,
          url: card.user.userid
            ? `https://www.xiaohongshu.com/user/profile/${card.user.userid}`
            : undefined,
        }
      : undefined,
    publishedAt: card.time ? new Date(card.time * 1000).toISOString() : undefined,
    metrics: {
      likes: parseCount(card.interact_info?.liked_count),
      comments: parseCount(card.interact_info?.comment_count),
      collects: parseCount(card.interact_info?.collected_count),
    },
    media: coverUrl
      ? [{ kind: 'cover', url: coverUrl, width: card.cover?.width, height: card.cover?.height }]
      : undefined,
    noteId,
  };
}

/**
 * 将用户笔记列表条目转换为标准 payload。
 */
export function userNoteToPayload(note: XhsUserNote): Record<string, unknown> {
  const kind = note.type === 'video' ? 'video' : 'post';
  const coverUrl = note.cover?.url ?? null;

  return {
    title: note.display_title ?? '',
    kind,
    publishedAt: note.time ? new Date(note.time * 1000).toISOString() : undefined,
    metrics: {
      likes: parseCount(note.interact_info?.liked_count),
      comments: parseCount(note.interact_info?.comment_count),
      collects: parseCount(note.interact_info?.collected_count),
    },
    media: coverUrl
      ? [{ kind: 'cover', url: coverUrl, width: note.cover?.width, height: note.cover?.height }]
      : undefined,
    noteId: note.note_id,
  };
}
