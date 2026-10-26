import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/components/auth/auth-provider';
import { FontPreload } from '@/components/font-preload';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: {
    default: '瓷砖经销商 ERP',
    template: '%s | 瓷砖经销商 ERP',
  },
  description: '瓷砖经销商 ERP 管理后台：基础资料、采购、销售、库存、财务一体化管理。',
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <FontPreload />
        <AuthProvider>{children}</AuthProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
