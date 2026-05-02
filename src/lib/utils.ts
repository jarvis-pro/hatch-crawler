import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { Run } from '@/lib/db';

/** shadcn 的常用 className 合并工具 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

// ─── 平台色标 ────────────────────────────────────────────────────────────────

/**
 * 平台 → Tailwind badge 色彩 class。
 * 供 spiders / subscriptions / batches / items 等页面共用，避免重复定义。
 */
export const PLATFORM_BADGE: Record<string, string> = {
  youtube: 'bg-red-100 text-red-800',
  bilibili: 'bg-blue-100 text-blue-800',
  xhs: 'bg-rose-100 text-rose-800',
  weibo: 'bg-orange-100 text-orange-800',
  douyin: 'bg-gray-100 text-gray-800',
};

/** 平台 badge JSX class，未知平台回退到灰色 */
export function platformBadgeClass(platform: string | null | undefined): string {
  return PLATFORM_BADGE[platform ?? ''] ?? 'bg-gray-100 text-gray-700';
}

// ─── 日期 / 时长工具 ─────────────────────────────────────────────────────────

/**
 * 将任意日期值格式化为 "MM/DD HH:mm" 字符串。
 * 传入 null / undefined / 非法值时返回 "—"。
 */
export function fmtDate(d: Date | string | number | null | undefined): string {
  if (d == null) return '—';
  const dt = d instanceof Date ? d : new Date(d as string | number);
  if (isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * 将 Run 的 startedAt → finishedAt（或 now）格式化为耗时字符串。
 * e.g. "3m 12s"
 */
export function durationLabel(run: Pick<Run, 'startedAt' | 'finishedAt'>): string {
  if (!run.startedAt) return '—';
  const end = run.finishedAt ? new Date(run.finishedAt) : new Date();
  const s = Math.floor((end.getTime() - new Date(run.startedAt).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ─── cron 可读化 ─────────────────────────────────────────────────────────────

const DOW_ZH = ['日', '一', '二', '三', '四', '五', '六'] as const;

/**
 * 将 cron 表达式转换为中文可读标签。
 * 仅支持 5 段标准 cron（不支持秒级 cron）。
 * e.g. "0 9 * * 1" → "每周一 09:00"
 */
export function cronLabel(expr: string | null | undefined): string {
  if (!expr) return '—';
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, , , dow] = parts;
  const hh = String(hour).padStart(2, '0');
  const mm = String(min).padStart(2, '0');
  if (dow === '*') return `每天 ${hh}:${mm}`;
  const d = parseInt(dow ?? '0', 10);
  return `每周${DOW_ZH[d] ?? dow} ${hh}:${mm}`;
}
