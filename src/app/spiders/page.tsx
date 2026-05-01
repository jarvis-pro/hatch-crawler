'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Spider } from '@/lib/db';
import { api, ApiClientError } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ── 注册表条目（来自 /api/spiders/registry）──────────────────────────────────
interface RegistryEntry {
  name: string;
  platform: string | null;
}

// ── Spider 参数字段定义 ────────────────────────────────────────────────────────
interface ParamField {
  key: string;
  label: string;
  required?: boolean;
  type?: 'text' | 'number' | 'select';
  options?: string[];
  defaultValue?: string | number;
  placeholder?: string;
  hint?: string;
}

/**
 * 已知 Spider 的结构化参数 schema。
 * 没有 schema 的 Spider 退化到 JSON 编辑器。
 */
const SPIDER_PARAM_SCHEMAS: Record<string, ParamField[]> = {
  'youtube-channel-videos': [
    {
      key: 'channelId',
      label: '频道 ID',
      required: true,
      placeholder: 'UCxxxxxxxxxxxxxxxxxxxxxx',
      hint: '在频道页 URL 中找到 UC 开头的字符串，例如 UCVHdiuAJBOEPiKMd9WnNvng',
    },
    { key: 'maxPages', label: '最多翻页数', type: 'number', defaultValue: 20 },
    {
      key: 'order',
      label: '排序方式',
      type: 'select',
      options: ['date', 'relevance', 'viewCount', 'rating', 'title'],
      defaultValue: 'date',
    },
    { key: 'maxResults', label: '每页结果数', type: 'number', defaultValue: 50 },
  ],
  'youtube-search': [
    {
      key: 'query',
      label: '搜索关键词',
      required: true,
      placeholder: 'TypeScript tutorial',
    },
    { key: 'maxPages', label: '最多翻页数', type: 'number', defaultValue: 5 },
    {
      key: 'order',
      label: '排序方式',
      type: 'select',
      options: ['relevance', 'date', 'viewCount', 'rating', 'title'],
      defaultValue: 'relevance',
    },
    { key: 'maxResults', label: '每页结果数', type: 'number', defaultValue: 50 },
  ],
  'bilibili-user-videos': [
    {
      key: 'uid',
      label: 'UP 主 UID',
      required: true,
      placeholder: '12345678',
      hint: '在 UP 主空间页 URL 中找到，例如 space.bilibili.com/12345678',
    },
    { key: 'maxPages', label: '最多翻页数', type: 'number', defaultValue: 10 },
    {
      key: 'order',
      label: '排序方式',
      type: 'select',
      options: ['pubdate', 'click', 'stow'],
      defaultValue: 'pubdate',
    },
    { key: 'pageSize', label: '每页结果数', type: 'number', defaultValue: 30 },
  ],
  'bilibili-search': [
    {
      key: 'query',
      label: '搜索关键词',
      required: true,
      placeholder: 'TypeScript 教程',
    },
    { key: 'maxPages', label: '最多翻页数', type: 'number', defaultValue: 5 },
    {
      key: 'order',
      label: '排序方式',
      type: 'select',
      options: ['totalrank', 'click', 'pubdate', 'dm', 'stow'],
      defaultValue: 'totalrank',
    },
    { key: 'pageSize', label: '每页结果数', type: 'number', defaultValue: 30 },
  ],
  'bilibili-video-detail': [
    {
      key: 'bvids',
      label: 'BV 号列表',
      required: true,
      placeholder: 'BV1xx411c7mD, BV1yy411c7mE',
      hint: '多个 BV 号用英文逗号分隔，或填写 JSON 数组',
    },
    { key: 'delayMs', label: '请求间隔（ms）', type: 'number', defaultValue: 1000 },
  ],
  'xhs-search': [
    {
      key: 'query',
      label: '搜索关键词',
      required: true,
      placeholder: '穿搭 旅行',
      hint: 'Cookie 需在"设置 → 凭据管理"中添加，平台选 xhs、类型选 Cookie',
    },
    { key: 'maxPages', label: '最多翻页数', type: 'number', defaultValue: 5 },
    {
      key: 'sort',
      label: '排序方式',
      type: 'select',
      options: ['general', 'time_descending', 'popularity_descending'],
      defaultValue: 'general',
    },
    {
      key: 'noteType',
      label: '笔记类型',
      type: 'select',
      options: ['0', '1', '2'],
      defaultValue: '0',
      hint: '0=不限，1=视频，2=图文',
    },
  ],
  'xhs-user-notes': [
    {
      key: 'userId',
      label: '用户 ID',
      required: true,
      placeholder: '5f1234abcd...',
      hint: '小红书个人主页 URL 中 /user/profile/ 后的字符串',
    },
    { key: 'maxPages', label: '最多翻页数', type: 'number', defaultValue: 10 },
  ],
  'xhs-note-detail': [
    {
      key: 'noteIds',
      label: '笔记 ID 列表',
      required: true,
      placeholder: 'abc123, def456',
      hint: '多个 ID 用英文逗号分隔，或填写 JSON 数组。笔记 ID 在笔记页 URL /explore/{noteId} 中',
    },
    { key: 'delayMs', label: '请求间隔（ms）', type: 'number', defaultValue: 2000 },
  ],
  'xhs-note-comments': [
    {
      key: 'noteId',
      label: '笔记 ID',
      required: true,
      placeholder: 'abc123def456...',
      hint: '笔记页 URL /explore/{noteId} 中的 ID',
    },
    { key: 'maxPages', label: '最多翻页数', type: 'number', defaultValue: 20 },
  ],
  'weibo-search': [
    {
      key: 'query',
      label: '搜索关键词',
      required: true,
      placeholder: '人工智能',
    },
    { key: 'maxPages', label: '最多翻页数', type: 'number', defaultValue: 5 },
    { key: 'delayMs', label: '请求间隔（ms）', type: 'number', defaultValue: 1500 },
  ],
  'weibo-user-posts': [
    {
      key: 'uid',
      label: '用户 UID',
      required: true,
      placeholder: '1234567890',
      hint: '微博个人主页 URL weibo.com/u/{uid} 中的纯数字 UID',
    },
    { key: 'maxPages', label: '最多翻页数', type: 'number', defaultValue: 10 },
    { key: 'delayMs', label: '请求间隔（ms）', type: 'number', defaultValue: 1500 },
  ],
  'douyin-search': [
    {
      key: 'keyword',
      label: '搜索关键词',
      required: true,
      placeholder: '美食探店',
    },
    { key: 'maxPages', label: '最多翻页数', type: 'number', defaultValue: 5 },
    { key: 'pageSize', label: '每页数量', type: 'number', defaultValue: 10 },
    { key: 'delayMs', label: '请求间隔（ms）', type: 'number', defaultValue: 2000 },
  ],
  'douyin-user-videos': [
    {
      key: 'secUid',
      label: '用户 sec_uid',
      required: true,
      placeholder: 'MS4wLjABAAAA...',
      hint: '抖音个人主页 URL douyin.com/user/{sec_uid} 中的长字符串',
    },
    { key: 'maxPages', label: '最多翻页数', type: 'number', defaultValue: 10 },
    { key: 'pageSize', label: '每页数量', type: 'number', defaultValue: 18 },
    { key: 'delayMs', label: '请求间隔（ms）', type: 'number', defaultValue: 2000 },
  ],
};

/** 根据注册名推荐显示名 */
const SPIDER_DISPLAY_NAMES: Record<string, string> = {
  'nextjs-blog': 'Next.js Blog',
  'youtube-channel-videos': 'YouTube 频道视频',
  'youtube-search': 'YouTube 搜索',
  'bilibili-user-videos': 'Bilibili UP 主投稿',
  'bilibili-search': 'Bilibili 搜索',
  'xhs-search': '小红书搜索',
  'xhs-user-notes': '小红书用户笔记',
  'xhs-note-detail': '小红书笔记详情',
  'xhs-note-comments': '小红书笔记评论',
  'bilibili-video-detail': 'Bilibili 视频详情',
  'weibo-search': '微博搜索',
  'weibo-user-posts': '微博用户微博',
  'douyin-search': '抖音搜索',
  'douyin-user-videos': '抖音用户视频',
};

const PLATFORM_BADGE: Record<string, string> = {
  youtube: 'bg-red-100 text-red-800',
  bilibili: 'bg-blue-100 text-blue-800',
};

// ── JSON fallback editor ──────────────────────────────────────────────────────

function JsonParamsEditor({
  value,
  onChange,
}: {
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState(JSON.stringify(value, null, 2));
  const [jsonErr, setJsonErr] = useState<string | null>(null);
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">参数（JSON）</label>
      <textarea
        className={`h-40 w-full rounded-md border bg-background p-3 font-mono text-xs ${jsonErr ? 'border-red-400' : ''}`}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value) as Record<string, unknown>);
            setJsonErr(null);
          } catch {
            setJsonErr('JSON 格式不合法');
          }
        }}
      />
      {jsonErr && <p className="text-xs text-red-500">{jsonErr}</p>}
    </div>
  );
}

// ── StructuredParamsForm ──────────────────────────────────────────────────────

function StructuredParamsForm({
  spiderName,
  value,
  onChange,
}: {
  spiderName: string;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const schema = SPIDER_PARAM_SCHEMAS[spiderName] ?? [];
  return (
    <div className="space-y-3">
      {schema.map((field) => (
        <div key={field.key} className="space-y-1">
          <label className="text-sm font-medium">
            {field.label}
            {field.required && <span className="ml-1 text-red-500">*</span>}
          </label>
          {field.type === 'select' ? (
            <select
              value={String(value[field.key] ?? field.defaultValue ?? '')}
              onChange={(e) => onChange({ ...value, [field.key]: e.target.value })}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              {field.options?.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <Input
              type={field.type === 'number' ? 'number' : 'text'}
              placeholder={field.placeholder}
              value={String(value[field.key] ?? field.defaultValue ?? '')}
              onChange={(e) =>
                onChange({
                  ...value,
                  [field.key]: field.type === 'number' ? Number(e.target.value) : e.target.value,
                })
              }
            />
          )}
          {field.hint && <p className="text-xs text-muted-foreground">{field.hint}</p>}
        </div>
      ))}
    </div>
  );
}

function ParamsForm({
  spiderName,
  value,
  onChange,
}: {
  spiderName: string;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  if (SPIDER_PARAM_SCHEMAS[spiderName]) {
    return <StructuredParamsForm spiderName={spiderName} value={value} onChange={onChange} />;
  }
  return <JsonParamsEditor value={value} onChange={onChange} />;
}

function defaultParamsFor(name: string): Record<string, unknown> {
  const schema = SPIDER_PARAM_SCHEMAS[name];
  if (!schema) return {};
  return Object.fromEntries(
    schema.filter((f) => f.defaultValue !== undefined).map((f) => [f.key, f.defaultValue]),
  );
}

function paramsValid(spiderName: string, params: Record<string, unknown>): boolean {
  const schema = SPIDER_PARAM_SCHEMAS[spiderName];
  if (!schema) return true;
  return schema
    .filter((f) => f.required)
    .every((f) => {
      const v = params[f.key];
      return v !== undefined && v !== '' && v !== null;
    });
}

// ── RunParamsDialog ───────────────────────────────────────────────────────────

function RunParamsDialog({ spider, onClose }: { spider: Spider; onClose: () => void }) {
  const qc = useQueryClient();
  const [params, setParams] = useState<Record<string, unknown>>({
    ...defaultParamsFor(spider.name),
    ...spider.defaultParams,
  });

  const run = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/api/runs', { spider: spider.name, overrides: params }),
    onSuccess: ({ id }) => {
      toast.success(`Run ${id.slice(0, 8)} 已入队`);
      void qc.invalidateQueries({ queryKey: ['runs'] });
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof ApiClientError ? err.message : String(err);
      toast.error(`启动失败：${msg}`);
    },
  });

  const hasParamsSchema =
    Boolean(SPIDER_PARAM_SCHEMAS[spider.name]) || Object.keys(spider.defaultParams).length > 0;
  const valid = paramsValid(spider.name, params);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>运行 {spider.displayName}</DialogTitle>
        </DialogHeader>
        <div className="py-2">
          {hasParamsSchema ? (
            <ParamsForm spiderName={spider.name} value={params} onChange={setParams} />
          ) : (
            <p className="text-sm text-muted-foreground">该 Spider 无需配置参数，直接运行即可。</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={run.isPending || !valid} onClick={() => run.mutate()}>
            {run.isPending ? '入队中…' : '运行'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── NewSpiderDialog ───────────────────────────────────────────────────────────

/** 将 Spider 类型名转换为合法的名称建议（仅供初始填充） */
function suggestName(type: string): string {
  return type;
}

function NewSpiderDialog({
  registry,
  onClose,
}: {
  registry: RegistryEntry[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const firstType = registry[0]?.name ?? '';
  // selectedType：注册表类型键（"youtube-channel-videos" 等）
  const [selectedType, setSelectedType] = useState(firstType);
  // customName：用户自定义的唯一标识符（PK），默认与类型名相同
  const [customName, setCustomName] = useState(suggestName(firstType));
  // 记录用户是否手动修改过 customName，如未修改则跟随类型自动更新
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false);
  const [displayName, setDisplayName] = useState(SPIDER_DISPLAY_NAMES[firstType] ?? firstType);
  const [enabled, setEnabled] = useState(true);
  const [params, setParams] = useState<Record<string, unknown>>(defaultParamsFor(firstType));
  // JSON 导入面板
  const [showImport, setShowImport] = useState(false);
  const [importJson, setImportJson] = useState('');
  const [importError, setImportError] = useState('');

  const handleTypeChange = (type: string) => {
    setSelectedType(type);
    setDisplayName(SPIDER_DISPLAY_NAMES[type] ?? type);
    setParams(defaultParamsFor(type));
    // 若用户还未手动编辑名称，则自动跟随类型更新
    if (!nameManuallyEdited) {
      setCustomName(suggestName(type));
    }
  };

  function handleImport() {
    setImportError('');
    try {
      const obj = JSON.parse(importJson) as Record<string, unknown>;
      const type = String(obj.name ?? obj.spiderType ?? '');
      if (type && registry.some((e) => e.name === type)) {
        setSelectedType(type);
        if (!nameManuallyEdited) setCustomName(suggestName(type));
        setDisplayName(String(obj.displayName ?? SPIDER_DISPLAY_NAMES[type] ?? type));
      }
      if (obj.displayName) setDisplayName(String(obj.displayName));
      if (typeof obj.enabled === 'boolean') setEnabled(obj.enabled);
      if (obj.defaultParams && typeof obj.defaultParams === 'object') {
        setParams(obj.defaultParams as Record<string, unknown>);
      }
      setShowImport(false);
      setImportJson('');
      toast.success('配置已导入');
    } catch {
      setImportError('JSON 解析失败，请检查格式');
    }
  }

  // 从注册表条目里取 platform，自动写入 DB
  const selectedEntry = registry.find((e) => e.name === selectedType);

  // 名称格式校验：只允许小写字母、数字、连字符，长度 1-64
  const nameValid = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/.test(customName.trim());

  const save = useMutation({
    mutationFn: () =>
      api.put<Spider>(`/api/spiders/${customName.trim()}`, {
        spiderType: selectedType,
        displayName,
        startUrls: [],
        enabled,
        platform: selectedEntry?.platform ?? null,
        defaultParams: params,
      }),
    onSuccess: () => {
      toast.success('Spider 已创建/更新');
      void qc.invalidateQueries({ queryKey: ['spiders'] });
      onClose();
    },
    onError: (err) => toast.error(String(err)),
  });

  const valid =
    nameValid &&
    displayName.trim().length > 0 &&
    selectedType.length > 0 &&
    paramsValid(selectedType, params);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between pr-6">
            新建 Spider
            <button
              type="button"
              onClick={() => {
                setShowImport((v) => !v);
                setImportError('');
              }}
              className="text-xs font-normal text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              {showImport ? '手动填写' : '从 JSON 导入'}
            </button>
          </DialogTitle>
        </DialogHeader>

        {showImport ? (
          /* ── JSON 导入面板 ── */
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              粘贴从 Spider 详情页导出的 JSON 配置文件内容：
            </p>
            <textarea
              className="h-48 w-full rounded-md border border-input bg-background p-2 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder='{"name": "youtube-search", "displayName": "...", "defaultParams": {...}}'
              value={importJson}
              onChange={(e) => setImportJson(e.target.value)}
            />
            {importError && <p className="text-xs text-destructive">{importError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowImport(false)}>
                取消
              </Button>
              <Button disabled={!importJson.trim()} onClick={handleImport}>
                解析并填入
              </Button>
            </div>
          </div>
        ) : (
          /* ── 手动填写表单 ── */
          <>
            <div className="space-y-4 py-2">
              {/* Spider 类型 */}
              <div className="space-y-1">
                <label className="text-sm font-medium">Spider 类型</label>
                <select
                  value={selectedType}
                  onChange={(e) => handleTypeChange(e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {registry.map((e) => (
                    <option key={e.name} value={e.name}>
                      {SPIDER_DISPLAY_NAMES[e.name] ?? e.name}
                      {e.platform ? ` (${e.platform})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* Spider 名称（唯一标识） */}
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  Spider 名称
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    （唯一 ID，可自定义）
                  </span>
                </label>
                <Input
                  value={customName}
                  onChange={(e) => {
                    setCustomName(e.target.value);
                    setNameManuallyEdited(true);
                  }}
                  placeholder="my-youtube-channel"
                  className={!nameValid && customName.length > 0 ? 'border-red-400' : ''}
                />
                {!nameValid && customName.length > 0 && (
                  <p className="text-xs text-red-500">
                    只允许小写字母、数字和连字符（-），且不能以连字符开头或结尾
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  同一类型可创建多个实例，用不同名称区分。例如两个 YouTube 频道可分别命名为{' '}
                  <code>yt-tech</code> 和 <code>yt-gaming</code>。
                </p>
              </div>

              {/* 显示名称 */}
              <div className="space-y-1">
                <label className="text-sm font-medium">显示名称</label>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="My Spider"
                />
              </div>

              {/* 默认参数 */}
              <div className="space-y-1">
                <label className="text-sm font-medium">默认参数（运行时可覆盖）</label>
                <ParamsForm spiderName={selectedType} value={params} onChange={setParams} />
              </div>

              {/* 启用 */}
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                启用（立即可运行）
              </label>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button disabled={save.isPending || !valid} onClick={() => save.mutate()}>
                {save.isPending ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── describeCron — cron 表达式转中文描述 ─────────────────────────────────────

function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, , dow] = parts;
  if (min === '*' && hour === '*') return '每分钟';
  if (min?.startsWith('*/') && hour === '*') return `每 ${min.slice(2)} 分钟`;
  if (hour?.startsWith('*/') && min === '0') return `每 ${hour.slice(2)} 小时整`;
  const h = hour !== '*' ? `${hour}:${(min ?? '0').padStart(2, '0')}` : null;
  if (dom === '*' && dow === '*' && h) return `每天 ${h}`;
  const DOW: Record<string, string> = {
    '0': '周日',
    '1': '周一',
    '2': '周二',
    '3': '周三',
    '4': '周四',
    '5': '周五',
    '6': '周六',
    '7': '周日',
  };
  if (dom === '*' && dow !== '*' && h) return `每${dow ? (DOW[dow] ?? `周${dow}`) : '?'} ${h}`;
  if (dom !== '*' && dow === '*' && h) return `每月 ${dom} 日 ${h}`;
  return expr;
}

// ── CronDialog ────────────────────────────────────────────────────────────────

const CRON_PRESETS = [
  { label: '每小时', value: '0 * * * *' },
  { label: '每天 09:00', value: '0 9 * * *' },
  { label: '每天 00:00', value: '0 0 * * *' },
  { label: '每 6 小时', value: '0 */6 * * *' },
  { label: '每周一 09:00', value: '0 9 * * 1' },
  { label: '每月 1 日', value: '0 9 1 * *' },
];

function CronDialog({ spider, onClose }: { spider: Spider; onClose: () => void }) {
  const qc = useQueryClient();
  const [expr, setExpr] = useState(spider.cronSchedule ?? '');

  const save = useMutation({
    mutationFn: () =>
      api.put<Spider>(`/api/spiders/${spider.name}`, {
        spiderType: spider.spiderType,
        displayName: spider.displayName,
        startUrls: spider.startUrls,
        allowedHosts: spider.allowedHosts,
        maxDepth: spider.maxDepth,
        concurrency: spider.concurrency,
        perHostIntervalMs: spider.perHostIntervalMs,
        enabled: spider.enabled,
        platform: spider.platform,
        defaultParams: spider.defaultParams,
        autoDownload: spider.autoDownload,
        cronSchedule: expr.trim() || null,
      }),
    onSuccess: () => {
      toast.success(expr.trim() ? `调度已设置：${expr.trim()}` : '调度已清除');
      void qc.invalidateQueries({ queryKey: ['spiders'] });
      onClose();
    },
    onError: (err) => toast.error(String(err)),
  });

  const preview = expr.trim() ? describeCron(expr.trim()) : '—';

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>定时调度 — {spider.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">Cron 表达式</label>
            <Input
              placeholder="0 9 * * * （留空则取消调度）"
              value={expr}
              onChange={(e) => setExpr(e.target.value)}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              预览：<span className="font-medium text-foreground">{preview}</span>
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">快捷选择</p>
            <div className="flex flex-wrap gap-1">
              {CRON_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setExpr(p.value)}
                  className="rounded border px-2 py-0.5 text-xs hover:bg-muted"
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setExpr('')}
                className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
              >
                清除
              </button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? '保存中…' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── SpidersPage ───────────────────────────────────────────────────────────────

export default function SpidersPage() {
  const qc = useQueryClient();
  const [runTarget, setRunTarget] = useState<Spider | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [cronTarget, setCronTarget] = useState<Spider | null>(null);

  const { data: spiders = [], isLoading } = useQuery({
    queryKey: ['spiders'],
    queryFn: () => api.get<Spider[]>('/api/spiders'),
  });

  const { data: registry = [] } = useQuery({
    queryKey: ['spiders-registry'],
    queryFn: () => api.get<RegistryEntry[]>('/api/spiders/registry'),
  });

  const toggleEnabled = useMutation({
    mutationFn: (s: Spider) =>
      api.put<Spider>(`/api/spiders/${s.name}`, {
        spiderType: s.spiderType,
        displayName: s.displayName,
        startUrls: s.startUrls,
        allowedHosts: s.allowedHosts,
        maxDepth: s.maxDepth,
        concurrency: s.concurrency,
        perHostIntervalMs: s.perHostIntervalMs,
        enabled: !s.enabled,
        cronSchedule: s.cronSchedule,
        platform: s.platform,
        defaultParams: s.defaultParams,
        autoDownload: s.autoDownload,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['spiders'] });
    },
    onError: (err) => toast.error(String(err)),
  });

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          已注册的 Spider。新建后在"立即运行"时填写参数即可开始抓取。
        </p>
        <Button size="sm" onClick={() => setShowCreate(true)} disabled={registry.length === 0}>
          + 新建 Spider
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>显示名称</TableHead>
                <TableHead>平台</TableHead>
                <TableHead>Cron</TableHead>
                <TableHead>启用</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && spiders.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    暂无 Spider，点击"新建 Spider"添加。
                  </TableCell>
                </TableRow>
              )}
              {spiders.map((s) => (
                <TableRow key={s.name}>
                  <TableCell className="font-mono text-xs">
                    <Link href={`/spiders/${s.name}`} className="hover:underline">
                      {s.name}
                    </Link>
                    {s.spiderType && s.spiderType !== s.name && (
                      <div className="mt-0.5 text-muted-foreground">{s.spiderType}</div>
                    )}
                  </TableCell>
                  <TableCell>{s.displayName}</TableCell>
                  <TableCell>
                    {s.platform ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${PLATFORM_BADGE[s.platform] ?? 'bg-gray-100 text-gray-700'}`}
                      >
                        {s.platform}
                      </span>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        —
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <button
                      className="font-mono text-xs hover:underline"
                      onClick={() => setCronTarget(s)}
                      title="点击编辑调度"
                    >
                      {s.cronSchedule ? (
                        <span className="text-foreground">{s.cronSchedule}</span>
                      ) : (
                        <span className="text-muted-foreground">— 设置</span>
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => toggleEnabled.mutate(s)}
                      title={s.enabled ? '点击禁用' : '点击启用'}
                    >
                      {s.enabled ? '✓ 启用' : '— 禁用'}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" disabled={!s.enabled} onClick={() => setRunTarget(s)}>
                      立即运行
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {runTarget && <RunParamsDialog spider={runTarget} onClose={() => setRunTarget(null)} />}
      {showCreate && <NewSpiderDialog registry={registry} onClose={() => setShowCreate(false)} />}
      {cronTarget && <CronDialog spider={cronTarget} onClose={() => setCronTarget(null)} />}
    </>
  );
}
