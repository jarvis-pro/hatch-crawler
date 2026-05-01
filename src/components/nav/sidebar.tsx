'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bug, Database, LayoutDashboard, ListChecks, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/spiders', label: 'Spiders', icon: Bug },
  { href: '/runs', label: 'Runs', icon: ListChecks },
  { href: '/items', label: 'Items', icon: Database },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex w-60 flex-col border-r bg-background">
      <div className="flex h-14 items-center border-b px-6 font-semibold">🕷️ hatch-crawler</div>
      <nav className="flex flex-1 flex-col gap-1 p-3">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
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
      </nav>
    </aside>
  );
}
