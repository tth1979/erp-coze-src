'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FileSpreadsheet, TrendingDown, TrendingUp } from 'lucide-react';
import { formatMoney } from '@/components/finance/balance-list';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch } from '@/lib/api-client';

interface FilingRow {
  rate: string;
  output_base: number;
  output_tax: number;
  input_base: number;
  input_tax: number;
}
interface FilingView {
  period: string;
  output_amount: number;
  output_base: number;
  output_tax: number;
  input_amount: number;
  input_base: number;
  input_tax: number;
  deductible_input: number;
  vat_payable: number;
  carried_forward: number;
  rows: FilingRow[];
}

const currentPeriod = () => new Date().toISOString().slice(0, 7);

function StatCard({ label, value, suffix, tone }: { label: string; value: number; suffix?: string; tone?: 'red' | 'green' | 'stone' }) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-green-700' : 'text-stone-900';
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${color}`}>
        {suffix === '%' ? `${value.toFixed(2)}%` : value.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
      </div>
    </div>
  );
}

/** 增值税纳税申报主表数据来源（雏形）：按期间汇总销项/进项税，计算应纳与留抵 */
export default function TaxFilingPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [result, setResult] = useState<FilingView | null>(null);
  const [loading, setLoading] = useState(true);

  function load(p: string): void {
    setLoading(true);
    apiFetch<FilingView>(`/api/tax/filing?period=${p}`)
      .then((data) => setResult(data))
      .catch((e) => toast.error('申报数据加载失败', { description: (e as Error).message }))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load(period);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const base = result ?? (null as unknown as FilingView);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-stone-500" />
          <div>
            <h1 className="text-base font-bold text-stone-900">增值税纳税申报（主表雏形）</h1>
            <p className="text-xs text-stone-500">按期间汇总销项/进项税额，应纳增值税 = 销项 − 可抵扣进项（销项不足则为留抵）</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 w-40" />
          <Button size="sm" onClick={() => load(period)} disabled={loading}>
            查询
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="mt-2 h-10 w-full" />
          <Skeleton className="mt-2 h-10 w-full" />
        </div>
      ) : !base ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-8 text-center text-sm text-stone-500">加载失败</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="销项税额合计" value={base.output_tax} tone="red" />
            <StatCard label="进项税额合计" value={base.input_tax} />
            <StatCard
              label="应纳税额（销项−可抵扣进项）"
              value={base.vat_payable}
              tone={base.vat_payable > 0 ? 'red' : 'green'}
            />
            <StatCard label="期末留抵税额" value={base.carried_forward} tone={base.carried_forward > 0 ? 'green' : 'stone'} />
          </div>

          {/* 税额构成明细 */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-stone-900">
                <TrendingUp className="h-4 w-4 text-red-500" />
                销项税额（按税率）
              </div>
              <div className="space-y-2 text-sm">
                {base.rows.length === 0 ? (
                  <p className="text-stone-400">本期无销项税登记</p>
                ) : (
                  base.rows.map((r) => (
                    <div key={r.rate} className="flex items-center justify-between border-b border-stone-100 py-1 last:border-0">
                      <span className="text-stone-600">税率 {r.rate}%</span>
                      <span className="tabular-nums text-red-600">
                        计税基数 ¥{formatMoney(r.output_base)} / 税额 ¥{formatMoney(r.output_tax)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold text-stone-900">
                <TrendingDown className="h-4 w-4 text-green-600" />
                进项税额（按税率）
              </div>
              <div className="space-y-2 text-sm">
                {base.rows.length === 0 ? (
                  <p className="text-stone-400">本期无进项税登记</p>
                ) : (
                  base.rows.map((r) => (
                    <div key={r.rate} className="flex items-center justify-between border-b border-stone-100 py-1 last:border-0">
                      <span className="text-stone-600">税率 {r.rate}%</span>
                      <span className="tabular-nums text-green-700">
                        计税基数 ¥{formatMoney(r.input_base)} / 税额 ¥{formatMoney(r.input_tax)}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <p className="text-xs text-stone-400">
            口径：销项=销售出库按商品税率计算；进项=采购入库（非暂估）及暂估冲回蓝字；可抵扣进项按全部进项计（雏形）。
          </p>
        </>
      )}
    </div>
  );
}