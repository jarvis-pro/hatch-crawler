'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bug,
  Database,
  KeyRound,
  LayoutDashboard,
  Link2,
  ListChecks,
  RefreshCw,
  Settings,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: '仪表盘', icon: LayoutDashboard },
  { href: '/extract', label: '快取', icon: Link2 },
  { href: '/subscriptions', label: '订阅', icon: RefreshCw },
  { href: '/batches', label: '批量', icon: Layers },
  { href: '/data', label: '数据', icon: Database },
  { href: '/credentials', label: '凭据', icon: KeyRound },
  { href: '/settings', label: '设置', icon: Settings },
];

const devItems = [
  { href: '/dev/spiders', label: 'Spiders', icon: Bug },
  { href: '/dev/runs', label: 'Runs', icon: ListChecks },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-60 flex-col border-r bg-background">
      <div className="flex h-14 items-center border-b px-6 font-semibold">🕷️ hatch-crawler</div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-secondary font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}

        {/* 开发者工具分区 */}
        <div className="mt-auto pt-4">
          <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Dev
          </p>
          {devItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-secondary font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </aside>
  );
}
