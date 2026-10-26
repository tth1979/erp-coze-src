'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Layers,
  LogOut,
  Package,
  Truck,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/auth/auth-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface NavItem {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  permission: string;
}

interface NavGroup {
  group?: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    items: [
      { title: '仪表盘', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.read' },
    ],
  },
  {
    group: '基础资料',
    items: [
      { title: '客户档案', href: '/master-data/customers', icon: Users, permission: 'md.read' },
      { title: '供应商', href: '/master-data/suppliers', icon: Truck, permission: 'md.read' },
      { title: '商品主数据', href: '/master-data/products', icon: Package, permission: 'md.read' },
    ],
  },
];

const ROLE_LABELS: Record<string, string> = {
  admin: '系统管理员',
  manager: '业务主管',
  staff: '业务员',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, can, logout } = useAuth();

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* 侧边导航：深炭灰，压住全局 */}
      <aside className="flex w-56 shrink-0 flex-col bg-stone-900 text-stone-300">
        <div className="flex h-14 items-center gap-2 border-b border-stone-700/60 px-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Layers className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-stone-50">瓷砖经销商 ERP</p>
            <p className="text-xs text-stone-400">管理后台</p>
          </div>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-4">
          {NAV.map((group, idx) => {
            const visible = group.items.filter((item) => can(item.permission));
            if (visible.length === 0) return null;
            return (
              <div key={group.group ?? idx}>
                {group.group ? (
                  <p className="px-2 pb-1 text-xs font-medium tracking-wider text-stone-500">
                    {group.group}
                  </p>
                ) : null}
                <ul className="space-y-0.5">
                  {visible.map((item) => {
                    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          className={cn(
                            'flex items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors duration-150',
                            active
                              ? 'bg-primary/15 font-medium text-primary-foreground'
                              : 'hover:bg-stone-800 hover:text-stone-100',
                          )}
                        >
                          <item.icon className={cn('h-4 w-4', active ? 'text-primary' : undefined)} />
                          {item.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="border-t border-stone-700/60 px-4 py-3 text-xs text-stone-500">v0.1.0 MVP</div>
      </aside>

      {/* 主区域 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b bg-card px-6">
          <p className="text-sm text-muted-foreground">高效管理每一笔瓷砖生意</p>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex items-center gap-2 rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-accent">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary/10 text-xs text-primary">
                  {user?.display_name?.slice(0, 1) ?? 'U'}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium">{user?.display_name}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>
                <p className="text-sm">{user?.display_name}</p>
                <p className="text-xs font-normal text-muted-foreground">
                  {user?.username} · {ROLE_LABELS[user?.role ?? ''] ?? user?.role}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLogout} className="cursor-pointer">
                <LogOut className="mr-2 h-4 w-4" />
                退出登录
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
