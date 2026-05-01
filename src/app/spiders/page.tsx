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
};

/** 根据注册名推荐显示名 */
const SPIDER_DISPLAY_NAMES: Record<string, string> = {
  'nextjs-blog': 'Next.js Blog',
  'youtube-channel-videos': 'YouTube 频道视频',
  'youtube-search': 'YouTube 搜索',
  'bilibili-user-videos': 'Bilibili UP 主投稿',
  'bilibili-search': 'Bilibili 搜索',
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

function NewSpiderDialog({
  registry,
  onClose,
}: {
  registry: RegistryEntry[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const firstName = registry[0]?.name ?? '';
  const [selectedName, setSelectedName] = useState(firstName);
  const [displayName, setDisplayName] = useState(SPIDER_DISPLAY_NAMES[firstName] ?? firstName);
  const [enabled, setEnabled] = useState(true);
  const [params, setParams] = useState<Record<string, unknown>>(defaultParamsFor(firstName));

  const handleTypeChange = (name: string) => {
    setSelectedName(name);
    setDisplayName(SPIDER_DISPLAY_NAMES[name] ?? name);
    setParams(defaultParamsFor(name));
  };

  // 从注册表条目里取 platform，自动写入 DB
  const selectedEntry = registry.find((e) => e.name === selectedName);

  const save = useMutation({
    mutationFn: () =>
      api.put<Spider>(`/api/spiders/${selectedName}`, {
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
    displayName.trim().length > 0 && selectedName.length > 0 && paramsValid(selectedName, params);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>新建 Spider</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {/* Spider 类型 */}
          <div className="space-y-1">
            <label className="text-sm font-medium">Spider 类型</label>
            <select
              value={selectedName}
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
            <ParamsForm spiderName={selectedName} value={params} onChange={setParams} />
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
      </DialogContent>
    </Dialog>
  );
}

// ── SpidersPage ───────────────────────────────────────────────────────────────

export default function SpidersPage() {
  const qc = useQueryClient();
  const [runTarget, setRunTarget] = useState<Spider | null>(null);
  const [showCreate, setShowCreate] = useState(false);

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
                  <TableCell className="font-mono text-xs">{s.cronSchedule ?? '—'}</TableCell>
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
    </>
  );
}
