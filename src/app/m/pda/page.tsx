'use client';

import Link from 'next/link';
import { useAuth } from '@/components/auth/auth-provider';
import { ArrowUpFromLine, ClipboardCheck, History, PackageSearch } from 'lucide-react';

const CARDS = [
  {
    href: '/m/pda/stock-io',
    icon: ArrowUpFromLine,
    title: '扫码出入库',
    desc: '采购入库 / 销售出库 扫码核对明细',
    accent: 'bg-rose-100 text-rose-700',
  },
  {
    href: '/m/pda/scan-count',
    icon: ClipboardCheck,
    title: '扫码盘点',
    desc: '选择仓库 → 扫条码录实盘 → 提交差异',
    accent: 'bg-emerald-100 text-emerald-700',
  },
  {
    href: '/m/pda/inventory',
    icon: PackageSearch,
    title: '库存查询',
    desc: '扫条码 / 商品 / 仓库 快速查余额',
    accent: 'bg-sky-100 text-sky-700',
  },
  {
    href: '/m/pda/movements',
    icon: History,
    title: '出入库核对',
    desc: '扫条码查看最近收发货流水与单号',
    accent: 'bg-amber-100 text-amber-700',
  },
];

export default function PdaHome() {
  const { user } = useAuth();
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-stone-900 p-5 text-white">
        <p className="text-sm text-stone-400">欢迎回来</p>
        <p className="mt-0.5 text-lg font-semibold">{user?.display_name ?? user?.username ?? ''}</p>
        <p className="mt-1 text-xs text-stone-400">PDA 手持端 · 仓库作业快捷入口</p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {CARDS.map(({ href, icon: Icon, title, desc, accent }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm active:scale-[0.99]"
          >
            <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl ${accent}`}>
              <Icon className="h-7 w-7" strokeWidth={2} />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold text-stone-800">{title}</span>
              <span className="block truncate text-sm text-stone-400">{desc}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}