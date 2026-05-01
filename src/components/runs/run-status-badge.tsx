import type { RunStatus } from '@/lib/db';
import { Badge } from '@/components/ui/badge';

const map: Record<
  RunStatus,
  {
    label: string;
    variant: 'secondary' | 'info' | 'success' | 'destructive' | 'warning';
  }
> = {
  queued: { label: 'queued', variant: 'secondary' },
  running: { label: 'running', variant: 'info' },
  completed: { label: 'completed', variant: 'success' },
  failed: { label: 'failed', variant: 'destructive' },
  stopped: { label: 'stopped', variant: 'warning' },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}
