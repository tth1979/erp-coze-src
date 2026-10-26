'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { History, ScanBarcode } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface MovementRow {
  id: string;
  warehouse_name: string;
  product_name: string;
  sku_code: string | null;
  unit: string | null;
  type: string;
  quantity: string;
  source: string;
  ref_no: string | null;
  unit_cost: string | null;
  created_at: string;
}

const SOURCE_LABEL: Record<string, string> = {
  purchase_in: '采购入库',
  sales_out: '销售出库',
  purchase_return: '采购退货',
  receipt_reversal: '暂估冲回',
  sales_return_in: '销售退货入',
  transfer_out: '调拨出',
  transfer_in: '调拨入',
  check_in: '盘盈',
  check_out: '盘亏',
  manufacture_finish: '加工完工',
  manufacture_issue: '加工领料',
  manual: '手工',
};

/** PDA 出入库扫码核对：扫条码查最近收发货流水与单号（复用 inv/movements，只读） */
export default function MovementsPage() {
  const [keyword, setKeyword] = useState('');
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = async (code?: string) => {
    const kw = (code ?? keyword).trim();
    if (!kw) {
      toast.warning('请扫条码或输单号');
      return;
    }
    setLoading(true);
    setSearched(true);
    try {
      const res = await apiFetch<{ items: MovementRow[] }>(
        `/api/inv/movements?keyword=${encodeURIComponent(kw)}&pageSize=30`,
      );
      setRows(res.items);
      if (res.items.length === 0) toast.info('未找到相关出入库流水');
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '查询失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-stone-800">出入库核对</h1>
        <span className="text-xs text-stone-400">台账流水 · 只读</span>
      </div>

      <div className="flex gap-2 rounded-2xl border border-stone-200 bg-white p-3">
        <input
          ref={inputRef}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') query();
          }}
          placeholder="扫条码 / 输商品或单号"
          className="min-w-0 flex-1 rounded-xl border border-stone-300 px-3 py-3 text-base"
        />
        <Button className="px-4" onClick={() => query()} disabled={loading}>
          <ScanBarcode className="h-5 w-5" />
        </Button>
      </div>

      <div className="space-y-2">
        {loading && <p className="py-8 text-center text-sm text-stone-400">查询中…</p>}
        {!loading &&
          rows.map((r) => {
            const qty = Number(r.quantity ?? 0);
            const inOut = r.type === 'in' || qty > 0;
            return (
              <div key={r.id} className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-stone-800">{r.product_name}</p>
                    <p className="truncate text-xs text-stone-400">
                      {r.sku_code} · {SOURCE_LABEL[r.source] ?? r.source}
                    </p>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-lg px-2 py-0.5 text-sm font-bold',
                      inOut ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700',
                    )}
                  >
                    {qty > 0 ? `+${qty}` : qty}
                    {r.unit ?? ''}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-stone-500">
                  <span className="rounded-md bg-stone-100 px-1.5 py-0.5">{r.ref_no ?? '—'}</span>
                  <span className="rounded-md bg-stone-100 px-1.5 py-0.5">{r.warehouse_name}</span>
                  {r.unit_cost != null && (
                    <span className="rounded-md bg-stone-100 px-1.5 py-0.5">成本 {r.unit_cost}</span>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] text-stone-300">{r.created_at}</p>
              </div>
            );
          })}
        {!loading && searched && rows.length === 0 && (
          <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-400">
            无流水，可换条码或单号重试
          </div>
        )}
      </div>

      <p className="pt-1 text-center text-xs text-stone-300">
        与桌面端「库存 → 台账流水」同源 ·{' '}
        <Link href="/inventory/movements" className="underline">
          前往桌面端
        </Link>
      </p>
    </div>
  );
}