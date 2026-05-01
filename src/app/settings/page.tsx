'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ── AccountRow 类型（与 src/lib/db/repositories/accounts.ts 对齐）──────────────
interface AccountRow {
  id: number;
  platform: string;
  label: string;
  kind: string;
  expiresAt: string | null;
  status: string;
  lastUsedAt: string | null;
  failureCount: number;
  // Phase D
  lastTestedAt: string | null;
  lastTestOk: boolean | null;
  quotaUsedToday: number;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  expired: 'bg-yellow-100 text-yellow-800',
  banned: 'bg-red-100 text-red-800',
  disabled: 'bg-gray-100 text-gray-600',
};

// ── Settings 页面 ─────────────────────────────────────────────────────────────

export default function SettingsPage() {
  return (
    <Tabs defaultValue="accounts">
      <TabsList>
        <TabsTrigger value="accounts">凭据管理</TabsTrigger>
        <TabsTrigger value="proxy">代理池</TabsTrigger>
        <TabsTrigger value="webhook">通知</TabsTrigger>
        <TabsTrigger value="downloads">下载</TabsTrigger>
        <TabsTrigger value="ua">UA 池</TabsTrigger>
        <TabsTrigger value="defaults">默认参数</TabsTrigger>
      </TabsList>
      <TabsContent value="accounts">
        <AccountsTab />
      </TabsContent>
      <TabsContent value="proxy">
        <ProxyTab />
      </TabsContent>
      <TabsContent value="webhook">
        <WebhookTab />
      </TabsContent>
      <TabsContent value="downloads">
        <DownloadsTab />
      </TabsContent>
      <TabsContent value="ua">
        <SettingEditor settingKey="ua_pool" />
      </TabsContent>
      <TabsContent value="defaults">
        <SettingEditor settingKey="defaults" />
      </TabsContent>
    </Tabs>
  );
}

// ── HealthBadge ───────────────────────────────────────────────────────────────

function HealthBadge({ ok, testedAt }: { ok: boolean | null; testedAt: string | null }) {
  if (testedAt === null || ok === null) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
        <span>—</span>
        <span>未测试</span>
      </span>
    );
  }
  if (ok) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800"
        title={`最后测试：${new Date(testedAt).toLocaleString()}`}
      >
        <span>✓</span>
        <span>正常</span>
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800"
      title={`最后测试：${new Date(testedAt).toLocaleString()}`}
    >
      <span>✗</span>
      <span>失效</span>
    </span>
  );
}

// ── Accounts Tab ──────────────────────────────────────────────────────────────

function AccountsTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get<AccountRow[]>('/api/accounts'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/api/accounts/${id}`),
    onSuccess: () => {
      toast.success('已删除');
      void qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err) => toast.error(String(err)),
  });

  const testAccount = useMutation({
    mutationFn: (id: number) =>
      api.post<{ valid: boolean; message: string }>(`/api/accounts/${id}/test`, {}),
    onSuccess: (data) => {
      if (data.valid) toast.success(data.message);
      else toast.error(`验证失败：${data.message}`);
      void qc.invalidateQueries({ queryKey: ['accounts'] });
    },
    onError: (err) => toast.error(String(err)),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          平台凭据（API Key / Cookie）加密存储，用于 Spider 抓取时注入鉴权。
        </p>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? '取消' : '+ 新增凭据'}
        </Button>
      </div>

      {showForm && (
        <AddAccountForm
          onSuccess={() => {
            setShowForm(false);
            void qc.invalidateQueries({ queryKey: ['accounts'] });
          }}
        />
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>平台</TableHead>
                <TableHead>标签</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>健康</TableHead>
                <TableHead>今日配额</TableHead>
                <TableHead>失败次数</TableHead>
                <TableHead>最近使用</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    加载中…
                  </TableCell>
                </TableRow>
              )}
              {accounts.length === 0 && !isLoading && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    暂无凭据，点击"新增凭据"添加。
                  </TableCell>
                </TableRow>
              )}
              {accounts.map((acc) => (
                <TableRow key={acc.id}>
                  <TableCell className="font-mono text-xs">{acc.platform}</TableCell>
                  <TableCell>{acc.label}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{acc.kind}</Badge>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[acc.status] ?? ''}`}
                    >
                      {acc.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    <HealthBadge ok={acc.lastTestOk} testedAt={acc.lastTestedAt} />
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {acc.kind === 'apikey' ? acc.quotaUsedToday.toLocaleString() : '—'}
                  </TableCell>
                  <TableCell className="text-xs">{acc.failureCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {acc.lastUsedAt ? new Date(acc.lastUsedAt).toLocaleString() : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {acc.kind === 'apikey' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={testAccount.isPending}
                          onClick={() => testAccount.mutate(acc.id)}
                        >
                          测试
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (confirm(`确认删除凭据"${acc.label}"？`)) remove.mutate(acc.id);
                        }}
                      >
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── 新增凭据表单 ──────────────────────────────────────────────────────────────

function AddAccountForm({ onSuccess }: { onSuccess: () => void }) {
  const [platform, setPlatform] = useState('youtube');
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'apikey' | 'cookie' | 'oauth' | 'session'>('apikey');
  const [payload, setPayload] = useState('');

  const create = useMutation({
    mutationFn: () => api.post('/api/accounts', { platform, label, kind, payload }),
    onSuccess: () => {
      toast.success('凭据已添加');
      onSuccess();
    },
    onError: (err) => toast.error(String(err)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">新增凭据</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">平台</label>
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="youtube">YouTube</option>
              <option value="bilibili">Bilibili</option>
              <option value="xhs">小红书 (XHS)</option>
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">类型</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'apikey' | 'cookie' | 'oauth' | 'session')}
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="apikey">API Key</option>
              <option value="cookie">Cookie</option>
              <option value="oauth">OAuth Token</option>
              <option value="session">Session</option>
            </select>
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">标签（用于区分多个同平台账号）</label>
          <Input
            placeholder="如：work-account-1"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">
            {kind === 'apikey' ? 'API Key' : kind === 'cookie' ? 'Cookie 字符串' : 'Token'}
          </label>
          <Input
            type="password"
            placeholder={
              kind === 'apikey' ? 'AIza...' : kind === 'cookie' ? '__Secure-SSID=...' : '粘贴 Token'
            }
            value={payload}
            onChange={(e) => setPayload(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            凭据会使用 AES-256-GCM 加密后存入数据库，明文不会保留。
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button disabled={create.isPending || !label || !payload} onClick={() => create.mutate()}>
            {create.isPending ? '保存中…' : '保存'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── 代理池 Tab ────────────────────────────────────────────────────────────────

function ProxyTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['setting', 'proxy_pool'],
    queryFn: () => api.get<{ key: string; value: unknown }>('/api/settings/proxy_pool'),
  });

  const [text, setText] = useState<string>('');
  const [initialized, setInitialized] = useState(false);

  // 从 settings 初始化：value 是字符串数组，每行一个 URL
  // 必须用 useEffect，避免在 render 里直接 setState：
  // 代理池为空时 [].join('\n') === '' 是 falsy，!text 永远为真，会无限循环
  useEffect(() => {
    if (data && !initialized) {
      const list = Array.isArray(data.value) ? (data.value as string[]) : [];
      setText(list.join('\n'));
      setInitialized(true);
    }
  }, [data, initialized]);

  const save = useMutation({
    mutationFn: (lines: string[]) => api.put('/api/settings/proxy_pool', { value: lines }),
    onSuccess: () => {
      toast.success('代理池已保存');
      void qc.invalidateQueries({ queryKey: ['setting', 'proxy_pool'] });
    },
    onError: (err) => toast.error(String(err)),
  });

  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return (
    <Card>
      <CardHeader>
        <CardTitle>代理池</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          每行填写一个代理地址，格式：
          <code className="rounded bg-muted px-1">http://user:pass@host:port</code>
          。保存后每次 Spider 运行时自动 round-robin 轮换。留空则直连。
        </p>
        <textarea
          className="h-48 w-full rounded-md border bg-background p-3 font-mono text-xs"
          placeholder={'http://proxy1:8080\nhttp://user:pass@proxy2:3128'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            {lines.length > 0 ? `${lines.length} 条代理` : '暂无代理（直连）'}
          </span>
          <Button disabled={save.isPending} onClick={() => save.mutate(lines)}>
            {save.isPending ? '保存中…' : '保存'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Webhook 通知 Tab ──────────────────────────────────────────────────────────

function WebhookTab() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['setting', 'webhook_url'],
    queryFn: () => api.get<{ key: string; value: unknown }>('/api/settings/webhook_url'),
  });
  const { data: maxFailData } = useQuery({
    queryKey: ['setting', 'max_consecutive_failures'],
    queryFn: () =>
      api.get<{ key: string; value: unknown }>('/api/settings/max_consecutive_failures'),
  });

  const [url, setUrl] = useState('');
  const [maxFail, setMaxFail] = useState('');

  useEffect(() => {
    if (data && typeof data.value === 'string') {
      setUrl(data.value);
    }
  }, [data]);

  useEffect(() => {
    if (maxFailData) {
      setMaxFail(String(maxFailData.value ?? '3'));
    }
  }, [maxFailData]);

  const save = useMutation({
    mutationFn: (webhookUrl: string) =>
      api.put('/api/settings/webhook_url', { value: webhookUrl || null }),
    onSuccess: () => {
      toast.success(url ? 'Webhook 已保存' : 'Webhook 已清除');
      void qc.invalidateQueries({ queryKey: ['setting', 'webhook_url'] });
    },
    onError: (err) => toast.error(String(err)),
  });

  const saveMaxFail = useMutation({
    mutationFn: (v: number) => api.put('/api/settings/max_consecutive_failures', { value: v }),
    onSuccess: () => {
      toast.success('告警阈值已保存');
      void qc.invalidateQueries({ queryKey: ['setting', 'max_consecutive_failures'] });
    },
    onError: (err) => toast.error(String(err)),
  });

  const testWebhook = useMutation({
    mutationFn: () => api.post('/api/settings/webhook_test', {}),
    onSuccess: () => toast.success('测试通知已发送'),
    onError: (err) => toast.error(`发送失败：${String(err)}`),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>完成通知</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            每次 Spider 运行完成或失败时，向此 URL 发送 POST 请求（JSON payload）。
            支持钉钉机器人、Slack Incoming Webhook、飞书机器人等。
          </p>
          <div className="space-y-1">
            <label className="text-sm font-medium">Webhook URL</label>
            <Input
              placeholder="https://hooks.slack.com/services/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2">
            {url && (
              <Button
                variant="outline"
                disabled={testWebhook.isPending}
                onClick={() => testWebhook.mutate()}
              >
                {testWebhook.isPending ? '发送中…' : '发送测试'}
              </Button>
            )}
            <Button disabled={save.isPending} onClick={() => save.mutate(url)}>
              {save.isPending ? '保存中…' : '保存'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>失败告警</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Spider 连续失败达到阈值后，将自动停用（enabled = false）并通过 Webhook 推送告警。 设为 0
            表示不自动停用。
          </p>
          <div className="flex items-center gap-3">
            <label className="whitespace-nowrap text-sm font-medium">连续失败停用阈值</label>
            <Input
              type="number"
              min={0}
              className="w-24"
              value={maxFail}
              onChange={(e) => setMaxFail(e.target.value)}
            />
            <span className="text-sm text-muted-foreground">次</span>
            <Button
              size="sm"
              disabled={saveMaxFail.isPending}
              onClick={() => {
                const n = parseInt(maxFail, 10);
                if (!isNaN(n) && n >= 0) saveMaxFail.mutate(n);
              }}
            >
              {saveMaxFail.isPending ? '保存中…' : '保存'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Downloads Tab（RFC 0002）──────────────────────────────────────────────────

interface SystemDepStatus {
  ok: boolean;
  version?: string;
  installHint?: string;
}
interface SystemDepsHealth {
  ffmpeg: SystemDepStatus;
  ytdlp: SystemDepStatus;
}

function DepBadge({ name, status }: { name: string; status: SystemDepStatus }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2">
      <div>
        <p className="font-mono text-sm">
          {name}{' '}
          {status.ok ? (
            <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">
              ✓ 可用
            </span>
          ) : (
            <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-800">
              ✗ 未安装
            </span>
          )}
        </p>
        {status.version && <p className="text-xs text-muted-foreground">{status.version}</p>}
        {!status.ok && status.installHint && (
          <p className="mt-1 text-xs text-orange-700">{status.installHint}</p>
        )}
      </div>
    </div>
  );
}

function DownloadsTab() {
  const qc = useQueryClient();

  const { data: health } = useQuery({
    queryKey: ['system', 'health'],
    queryFn: () => api.get<SystemDepsHealth>('/api/system/health'),
  });

  const { data: ytEnabled } = useQuery({
    queryKey: ['setting', 'enable_youtube_download'],
    queryFn: () =>
      api.get<{ key: string; value: unknown }>('/api/settings/enable_youtube_download'),
  });

  const enabled = Boolean(ytEnabled?.value);

  const save = useMutation({
    mutationFn: (v: boolean) => api.put('/api/settings/enable_youtube_download', { value: v }),
    onSuccess: (_, v) => {
      toast.success(v ? 'YouTube 下载已启用' : 'YouTube 下载已禁用');
      void qc.invalidateQueries({ queryKey: ['setting', 'enable_youtube_download'] });
    },
    onError: (err) => toast.error(String(err)),
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>系统依赖</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            下载与转码功能需要本机装有 ffmpeg / yt-dlp。Docker 镜像已内置；本地 dev 用 brew 安装。
          </p>
          {health && (
            <div className="space-y-2">
              <DepBadge name="ffmpeg" status={health.ffmpeg} />
              <DepBadge name="yt-dlp" status={health.ytdlp} />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>YouTube 下载</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-md border-l-4 border-orange-400 bg-orange-50 px-3 py-2 text-sm text-orange-900">
            <p className="font-medium">⚠ 法律与合规提示</p>
            <p className="mt-1 text-xs leading-relaxed">
              YouTube 服务条款 §III.E 禁止"通过下载之外的方式访问内容"。 使用 yt-dlp
              下载第三方视频在个人 / 教育 / 研究场景广泛使用，但 <strong>商用风险高</strong>，
              请确认你的使用场景合规后再启用。启用后，下载队列对 youtube 系 host 限并发为
              1，避免触发风控。
            </p>
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <p className="text-sm font-medium">启用 YouTube 下载（yt-dlp）</p>
              <p className="text-xs text-muted-foreground">
                关闭时，视频/音频下载按钮不显示 yt-dlp 选项。
              </p>
            </div>
            <Button
              variant={enabled ? 'destructive' : 'default'}
              size="sm"
              disabled={save.isPending || (!enabled && !health?.ytdlp.ok)}
              onClick={() => save.mutate(!enabled)}
              title={!enabled && !health?.ytdlp.ok ? '请先安装 yt-dlp 再启用' : undefined}
            >
              {save.isPending ? '...' : enabled ? '禁用' : '启用'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── 通用 Setting 编辑器（复用原有逻辑）────────────────────────────────────────

function SettingEditor({ settingKey }: { settingKey: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ['setting', settingKey],
    queryFn: () => api.get<{ key: string; value: unknown }>(`/api/settings/${settingKey}`),
  });

  const [text, setText] = useState<string>('');

  useEffect(() => {
    if (data) {
      setText(JSON.stringify(data.value ?? {}, null, 2));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: (value: unknown) => api.put(`/api/settings/${settingKey}`, { value }),
    onSuccess: () => {
      toast.success('已保存');
      void qc.invalidateQueries({ queryKey: ['setting', settingKey] });
    },
    onError: (err) => toast.error(String(err)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-mono">{settingKey}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <textarea
          className="h-72 w-full rounded-md border bg-background p-3 font-mono text-xs"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex justify-end">
          <Button
            disabled={save.isPending}
            onClick={() => {
              try {
                const parsed = JSON.parse(text) as unknown;
                save.mutate(parsed);
              } catch (err) {
                toast.error(`JSON 不合法：${String(err)}`);
              }
            }}
          >
            {save.isPending ? '保存中…' : '保存'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
