'use client';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

const titleMap: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/spiders': 'Spiders',
  '/runs': 'Runs',
  '/items': 'Items',
  '/attachments': 'Attachments',
  '/settings': 'Settings',
};

export function Topbar() {
  const pathname = usePathname();
  const title =
    Object.entries(titleMap).find(([prefix]) => pathname.startsWith(prefix))?.[1] ??
    'hatch-crawler';

  // DB 健康度：拿一次 stats 成功就是绿
  const { data, isError } = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<{ running: number }>('/api/stats/summary'),
    refetchInterval: 30_000,
    retry: false,
  });
  const healthy = !isError && data !== undefined;

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-6">
      <h1 className="text-base font-semibold">{title}</h1>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className={`inline-block h-2 w-2 rounded-full ${healthy ? 'bg-green-500' : 'bg-red-500'}`}
        />
        {healthy ? 'DB connected' : 'DB unreachable'}
      </div>
    </header>
  );
}
