'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ClipboardCheck, Home, History, PackageSearch } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/m/pda', label: '首页', icon: Home },
  { href: '/m/pda/inventory', label: '查余额', icon: PackageSearch },
  { href: '/m/pda/scan-count', label: '盘点', icon: ClipboardCheck },
  { href: '/m/pda/movements', label: '流向', icon: History },
];

/** PDA / 移动端口袋版布局：路由守卫 + 底部大按钮导航 */
export default function MobileLayout({ children }: { children: React.ReactNode }) {
  const { status, user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'guest') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  return (
    <div className="min-h-dvh bg-stone-50">
      {/* 顶栏 */}
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-stone-200 bg-white px-4">
        <div className="flex items-center gap-2 font-semibold text-stone-800">
          <span className="rounded bg-stone-900 px-1.5 py-0.5 text-xs text-white">PDA</span>
          仓库作业
        </div>
        <div className="flex items-center gap-3 text-sm">
          {status === 'authed' && user && (
            <>
              <span className="hidden text-stone-500 sm:inline">{user.display_name ?? user.username}</span>
              <Link href="/" className="rounded border border-stone-200 px-2 py-1 text-xs text-stone-600">
                桌面端
              </Link>
              <button
                type="button"
                onClick={() => {
                  void logout();
                  router.replace('/login');
                }}
                className="text-xs text-stone-500 underline-offset-2 hover:underline"
              >
                退出
              </button>
            </>
          )}
        </div>
      </header>

      {/* 内容 */}
      <main className="mx-auto w-full max-w-3xl px-3 pb-24 pt-4 md:px-5">{children}</main>

      {/* 底部导航 */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white">
        <div className="mx-auto grid max-w-3xl grid-cols-4">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/m/pda' && pathname.startsWith(`${href}/`));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex flex-col items-center gap-0.5 py-2.5 text-xs',
                  active ? 'text-stone-900' : 'text-stone-400',
                )}
              >
                <Icon className="h-6 w-6" strokeWidth={active ? 2.2 : 1.8} />
                {label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}