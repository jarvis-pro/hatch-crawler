'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// ── AccountRow 类型 ───────────────────────────────────────────────────────────

interface AccountRow {
  id: number;
  platform: string;
  label: string;
  kind: string;
  expiresAt: string | null;
  status: string;
  lastUsedAt: string | null;
  failureCount: number;
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
              <option value="weibo">微博</option>
              <option value="douyin">抖音</option>
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

// ── 页面主体 ──────────────────────────────────────────────────────────────────

export default function CredentialsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AccountRow | null>(null);

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

  const unban = useMutation({
    mutationFn: (id: number) =>
      api.patch<{ unbanned: boolean }>(`/api/accounts/${id}`, { action: 'unban' }),
    onSuccess: () => {
      toast.success('已恢复为 active，失败计数已清零');
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
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">凭据管理</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              平台 API Key / Cookie 加密存储，Spider 运行时自动注入鉴权。
            </p>
          </div>
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
                        {acc.status === 'banned' && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={unban.isPending}
                            onClick={() => unban.mutate(acc.id)}
                            className="text-green-700 hover:text-green-800"
                          >
                            恢复
                          </Button>
                        )}
                        {acc.kind === 'apikey' && acc.status !== 'banned' && (
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
                          onClick={() => setDeleteTarget(acc)}
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

      <ConfirmDialog
        open={!!deleteTarget}
        title="删除凭据"
        description={
          deleteTarget ? (
            <>
              确认删除凭据「
              <span className="font-medium text-foreground">{deleteTarget.label}</span>
              」？此操作不可撤销。
            </>
          ) : (
            ''
          )
        }
        confirmText="确认删除"
        danger
        isPending={remove.isPending}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}
