import type { RunStatus } from '@/lib/db';
import { Badge } from '@/components/ui/badge';

const map: Record<
  RunStatus,
  {
    label: string;
    variant: 'secondary' | 'info' | 'success' | 'destructive' | 'warning';
  }
> = {
  queued: { label: '排队中', variant: 'secondary' },
  running: { label: '运行中', variant: 'info' },
  completed: { label: '已完成', variant: 'success' },
  failed: { label: '已失败', variant: 'destructive' },
  stopped: { label: '已停止', variant: 'warning' },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}
