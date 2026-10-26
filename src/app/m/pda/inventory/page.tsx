'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { PackageSearch, ScanBarcode } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface StockRow {
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  product_id: string;
  product_name: string;
  sku_code: string | null;
  spec: string | null;
  unit: string | null;
  quantity: string;
  frozen_quantity: string;
  available_quantity: string;
  in_transit: string;
  avg_cost: string;
}

/** PDA 口袋版库存查询：扫条码 / 商品 / 仓库 快速查余额（复用 inv/stock） */
export default function InventoryPage() {
  const [keyword, setKeyword] = useState('');
  const [rows, setRows] = useState<StockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = async (code?: string) => {
    const kw = (code ?? keyword).trim();
    if (!kw) {
      toast.warning('请输入条码 / 商品 / 编码');
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const res = await apiFetch<{ items: StockRow[] }>(
        `/api/inv/stock?keyword=${encodeURIComponent(kw)}&pageSize=100`,
      );
      setRows(res.items);
      if (res.items.length === 0) toast.info('未查询到库存');
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '查询失败');
    } finally {
      setLoading(false);
    }
  };

  const total = rows.reduce((s, r) => s + Number(r.quantity ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-stone-800">库存查询</h1>
        <span className="text-xs text-stone-400">口袋版 · 跨仓</span>
      </div>

      <div className="flex gap-2 rounded-2xl border border-stone-200 bg-white p-3">
        <input
          ref={inputRef}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') query();
          }}
          placeholder="扫条码 / 输商品名或编码"
          className="min-w-0 flex-1 rounded-xl border border-stone-300 px-3 py-3 text-base"
        />
        <Button className="px-4" onClick={() => query()} disabled={loading}>
          <ScanBarcode className="h-5 w-5" />
        </Button>
      </div>

      {searched && (
        <div className="flex items-center justify-between rounded-xl bg-stone-100 px-4 py-3 text-sm">
          <span className="text-stone-600">匹配 {rows.length} 仓·行</span>
          <span className="font-semibold text-stone-800">合计现有 {total}</span>
        </div>
      )}

      <div className="space-y-2">
        {loading && <p className="py-8 text-center text-sm text-stone-400">查询中…</p>}
        {!loading &&
          rows.map((r) => {
            const q = Number(r.quantity ?? 0);
            const avail = Number(r.available_quantity ?? 0);
            const frozen = Number(r.frozen_quantity ?? 0);
            return (
              <div key={r.id} className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-stone-800">{r.product_name}</p>
                    <p className="truncate text-xs text-stone-400">
                      {r.sku_code} {r.spec ? `· ${r.spec}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-lg bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
                    {r.warehouse_name}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-emerald-50 py-2">
                    <p className="text-base font-bold text-emerald-700">{q}</p>
                    <p className="text-[11px] text-emerald-500">现有{r.unit ?? ''}</p>
                  </div>
                  <div
                    className={cn(
                      'rounded-xl py-2',
                      avail < 0 ? 'bg-rose-50' : 'bg-sky-50',
                    )}
                  >
                    <p className={cn('text-base font-bold', avail < 0 ? 'text-rose-700' : 'text-sky-700')}>
                      {avail}
                    </p>
                    <p className="text-[11px] text-stone-400">可用</p>
                  </div>
                  <div className="rounded-xl bg-amber-50 py-2">
                    <p className="text-base font-bold text-amber-700">{frozen}</p>
                    <p className="text-[11px] text-amber-500">冻结</p>
                  </div>
                </div>
              </div>
            );
          })}
        {!loading && searched && rows.length === 0 && (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-400">
            无结果，可换条码或商品名重试
          </div>
        )}
      </div>

      <p className="pt-1 text-center text-xs text-stone-300">
        与桌面端「库存 → 库存余额」同源 ·{' '}
        <Link href="/inventory/stock" className="underline">
          前往桌面端
        </Link>
      </p>
    </div>
  );
}