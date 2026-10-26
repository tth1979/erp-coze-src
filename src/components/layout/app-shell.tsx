'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Layers,
  LogOut,
  Menu,
  Package,
  Receipt,
  ShoppingCart,
  Truck,
  Users,
  X,
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
  {
    group: '采购管理',
    items: [
      { title: '采购订单', href: '/purchase/orders', icon: ShoppingCart, permission: 'po.read' },
    ],
  },
  {
    group: '销售管理',
    items: [
      { title: '销售订单', href: '/sales/orders', icon: Receipt, permission: 'so.read' },
    ],
  },
];

const ROLE_LABELS: Record<string, string> = {
  admin: '系统管理员',
  manager: '业务主管',
  staff: '业务员',
};

function currentPageTitle(pathname: string): string {
  for (const group of NAV) {
    for (const item of group.items) {
      if (pathname === item.href || pathname.startsWith(`${item.href}/`)) {
        return item.title;
      }
    }
  }
  return '瓷砖经销商 ERP';
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, can, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 路由切换后自动收起移动端抽屉
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // 抽屉打开时锁定背景滚动
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  async function onLogout() {
    await logout();
    router.replace('/login');
  }

  const sidebar = (
    <div className="flex h-full flex-col bg-stone-900 text-stone-300">
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
    </div>
  );

  return (
    <div className="flex min-h-screen bg-background">
      {/* 桌面端常驻侧边导航：深炭灰，压住全局 */}
      <aside className="hidden w-56 shrink-0 lg:block">{sidebar}</aside>

      {/* 移动端抽屉导航 */}
      <div
        className={cn(
          'fixed inset-0 z-50 lg:hidden',
          drawerOpen ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        aria-hidden={!drawerOpen}
      >
        {/* 遮罩 */}
        <div
          className={cn(
            'absolute inset-0 bg-stone-950/50 transition-opacity duration-150',
            drawerOpen ? 'opacity-100' : 'opacity-0',
          )}
          onClick={() => setDrawerOpen(false)}
        />
        {/* 抽屉面板 */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="导航菜单"
          className={cn(
            'absolute inset-y-0 left-0 w-[260px] max-w-[85vw] shadow-xl transition-transform duration-200 ease-out',
            drawerOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <button
            type="button"
            aria-label="关闭导航"
            onClick={() => setDrawerOpen(false)}
            className="absolute right-2 top-2 z-10 rounded-md p-2 text-stone-400 transition-colors hover:bg-stone-800 hover:text-stone-100"
          >
            <X className="h-5 w-5" />
          </button>
          {sidebar}
        </div>
      </div>

      {/* 主区域 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-card px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              aria-label="打开导航"
              onClick={() => setDrawerOpen(true)}
              className="-ml-1 rounded-md p-2 text-foreground transition-colors hover:bg-accent lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <p className="truncate text-sm font-medium text-foreground lg:font-normal lg:text-muted-foreground">
              <span className="lg:hidden">{currentPageTitle(pathname)}</span>
              <span className="hidden lg:inline">高效管理每一笔瓷砖生意</span>
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1.5 outline-none transition-colors hover:bg-accent">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-primary/10 text-xs text-primary">
                  {user?.display_name?.slice(0, 1) ?? 'U'}
                </AvatarFallback>
              </Avatar>
              <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:inline">
                {user?.display_name}
              </span>
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
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
