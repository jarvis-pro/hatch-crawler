/* eslint-disable no-console */
/**
 * RFC 0002 Phase A —— 下载链路烟雾测试
 *
 * 走真实 HTTP API + worker 队列，验证完整链路：
 *   POST /api/items/:id/attachments → pg-boss 队列 → download-job-handler
 *     → http-fetcher → file storage → attachments 表 markCompleted
 *
 * 必须在 dev server 运行时执行（默认 http://localhost:3000）。
 *
 * 用法：
 *   pnpm dev              # 另开终端
 *   pnpm smoke:download   # [optional URL]
 */

const BASE = process.env.SMOKE_BASE ?? 'http://localhost:3000';
const DEFAULT_URL = 'https://download.samplelib.com/mp3/sample-3s.mp3';

interface ApiOk<T> {
  ok: true;
  data: T;
}
interface ApiErr {
  ok: false;
  error: { code: string; message: string };
}
type ApiEnv<T> = ApiOk<T> | ApiErr;

async function apiGet<T>(p: string): Promise<T> {
  const r = await fetch(`${BASE}${p}`);
  const j = (await r.json()) as ApiEnv<T>;
  if (!j.ok) throw new Error(`GET ${p} → ${j.error.code}: ${j.error.message}`);
  return j.data;
}
async function apiPost<T>(p: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${p}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as ApiEnv<T>;
  if (!j.ok) throw new Error(`POST ${p} → ${j.error.code}: ${j.error.message}`);
  return j.data;
}
async function apiDelete<T>(p: string): Promise<T> {
  const r = await fetch(`${BASE}${p}`, { method: 'DELETE' });
  const j = (await r.json()) as ApiEnv<T>;
  if (!j.ok) throw new Error(`DELETE ${p} → ${j.error.code}: ${j.error.message}`);
  return j.data;
}

interface AttachmentRow {
  id: string;
  status: 'queued' | 'downloading' | 'transcoding' | 'completed' | 'failed';
  storagePath: string | null;
  byteSize: number | null;
  sha256: string | null;
  errorMessage: string | null;
  progressPct: number | null;
}

interface ItemListPage {
  data: { id: number; spider: string; url: string }[];
  total: number;
}

async function main(): Promise<void> {
  const url = process.argv[2] ?? DEFAULT_URL;
  console.log('[smoke] target dev server:', BASE);
  console.log('[smoke] download URL:', url);

  // 1) 找一个 item 挂载（最新一条）
  const items = await apiGet<ItemListPage>('/api/items?page=1&pageSize=1');
  const item = items.data[0];
  if (!item) throw new Error('no items in DB; please seed or run a spider first');
  console.log('[smoke] using item:', item.id, item.spider, item.url.slice(0, 60));

  // 2) 创建 attachment + 入队
  const attachment = await apiPost<AttachmentRow>(`/api/items/${item.id}/attachments`, {
    url,
    kind: 'audio',
    fetcherKind: 'http',
  });
  console.log('[smoke] created attachment:', attachment.id);

  // 3) 轮询直到终态（30 秒上限）
  const deadline = Date.now() + 30_000;
  let final: AttachmentRow | null = null;
  while (Date.now() < deadline) {
    const cur = await apiGet<AttachmentRow>(`/api/attachments/${attachment.id}`);
    process.stdout.write(`\r[smoke] status=${cur.status} pct=${String(cur.progressPct ?? 0)}%   `);
    if (cur.status === 'completed' || cur.status === 'failed') {
      final = cur;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  process.stdout.write('\n');

  if (!final) throw new Error('timeout waiting for download to finish');
  if (final.status !== 'completed') {
    throw new Error(`download failed: ${final.errorMessage ?? '(no message)'}`);
  }

  console.log('[smoke] storagePath:', final.storagePath);
  console.log('[smoke] byteSize:', final.byteSize);
  console.log('[smoke] sha256:', final.sha256);

  // 4) 验证 GET /api/attachments/:id/download 真的返回文件
  const dl = await fetch(`${BASE}/api/attachments/${attachment.id}/download`);
  if (!dl.ok) throw new Error(`download endpoint failed: HTTP ${String(dl.status)}`);
  const buf = await dl.arrayBuffer();
  if (buf.byteLength !== final.byteSize) {
    throw new Error(
      `download size mismatch: got=${String(buf.byteLength)} db=${String(final.byteSize)}`,
    );
  }
  console.log('[smoke] file downloadable, bytes:', buf.byteLength);

  // 5) 清理
  await apiDelete<{ deleted: boolean }>(`/api/attachments/${attachment.id}`);
  console.log('[smoke] ✓ end-to-end download chain works');
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error('[smoke] FAILED:', err);
  process.exit(1);
});
