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
  prepaid_total: number;
  net_payable: number;
  refundable: number;
  soc_diff: {
    temporary_count: number;
    temporary_amount: number;
    permanent_count: number;
    permanent_amount: number;
  };
  rows: FilingRow[];
}

interface WorksheetView {
  period: string;
  output_tax: number;
  input_tax: number;
  deductible_input: number;
  vat_before_prepaid: number;
  carried_forward: number;
  prepaid_total: number;
  net_payable: number;
  refundable: number;
  invoice_input_count: number;
  invoice_output_count: number;
  invoice_input_tax: number;
  invoice_output_tax: number;
  soc_diff: { temporary_count: number; temporary_amount: number; permanent_count: number; permanent_amount: number };
  sources: { key: string; label: string; amount: number }[];
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
  const [worksheet, setWorksheet] = useState<WorksheetView | null>(null);
  const [loading, setLoading] = useState(true);

  function load(p: string): void {
    setLoading(true);
    Promise.all([
      apiFetch<FilingView>(`/api/tax/filing?period=${p}`),
      apiFetch<WorksheetView>(`/api/tax/worksheet?period=${p}`).catch(() => null),
    ])
      .then(([data, ws]) => {
        setResult(data);
        setWorksheet(ws);
      })
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

          {/* 预缴抵减与应补退 */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="应纳增值税（抵预缴前）" value={base.vat_payable} tone={base.vat_payable > 0 ? 'red' : 'stone'} />
            <StatCard label="已预缴税额（异地）" value={base.prepaid_total} tone="green" />
            <StatCard label="应补税额" value={base.net_payable} tone={base.net_payable > 0 ? 'red' : 'stone'} />
            <StatCard label="应退税额" value={base.refundable} tone={base.refundable > 0 ? 'green' : 'stone'} />
          </div>

          {/* 税会差异提示 */}
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-bold text-stone-900">
              <FileSpreadsheet className="h-4 w-4 text-amber-500" />
              税会差异提示
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-stone-600">
              <span>时间性差异：<span className="font-semibold text-amber-600">{base.soc_diff.temporary_count}</span> 项 · 差异额 ¥{formatMoney(base.soc_diff.temporary_amount)}</span>
              <span>永久性差异（汇算清缴）：<span className="font-semibold text-purple-600">{base.soc_diff.permanent_count}</span> 项 · 差异额 ¥{formatMoney(base.soc_diff.permanent_amount)}</span>
            </div>
            <p className="mt-1 text-xs text-stone-400">日常仅提示时间性差异；永久性差异留待企业所得税汇算清缴处理。</p>
          </div>

          {/* 申报底稿来源 */}
          {worksheet && (
            <div className="rounded-lg border border-stone-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-bold text-stone-900">
                  <FileSpreadsheet className="h-4 w-4 text-stone-500" />
                  申报底稿（来源逐项列示）
                </div>
                <Button variant="outline" size="sm" onClick={() => window.print()}>导出/打印</Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-xs text-stone-500">
                      <th className="py-1 text-left font-medium">项目</th>
                      <th className="py-1 text-right font-medium">金额</th>
                      <th className="py-1 text-left font-medium">来源</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-stone-100">
                      <td className="py-1.5">销项税额</td>
                      <td className="py-1.5 text-right tabular-nums text-red-600">¥{formatMoney(worksheet.output_tax)}</td>
                      <td className="py-1.5 text-xs text-stone-500">tax_entries / 发票台账 {worksheet.invoice_output_count} 张</td>
                    </tr>
                    <tr className="border-b border-stone-100">
                      <td className="py-1.5">进项税额</td>
                      <td className="py-1.5 text-right tabular-nums text-green-700">¥{formatMoney(worksheet.input_tax)}</td>
                      <td className="py-1.5 text-xs text-stone-500">tax_entries / 发票台账 {worksheet.invoice_input_count} 张</td>
                    </tr>
                    <tr className="border-b border-stone-100">
                      <td className="py-1.5">应纳增值税（抵预缴前）</td>
                      <td className="py-1.5 text-right tabular-nums">¥{formatMoney(worksheet.vat_before_prepaid)}</td>
                      <td className="py-1.5 text-xs text-stone-500">销项 − 可抵扣进项</td>
                    </tr>
                    <tr className="border-b border-stone-100">
                      <td className="py-1.5">减：异地预缴税额</td>
                      <td className="py-1.5 text-right tabular-nums">¥{formatMoney(worksheet.prepaid_total)}</td>
                      <td className="py-1.5 text-xs text-stone-500">tax_prepaid</td>
                    </tr>
                    <tr className="border-b border-stone-100 font-semibold">
                      <td className="py-1.5">应补(退)税额</td>
                      <td className="py-1.5 text-right tabular-nums text-stone-900">¥{formatMoney(worksheet.net_payable > 0 ? worksheet.net_payable : -worksheet.refundable)}</td>
                      <td className="py-1.5 text-xs text-stone-500">{worksheet.net_payable > 0 ? '应补' : worksheet.refundable > 0 ? '应退' : '平衡'}</td>
                    </tr>
                    <tr>
                      <td className="py-1.5">期末留抵税额</td>
                      <td className="py-1.5 text-right tabular-nums">¥{formatMoney(worksheet.carried_forward)}</td>
                      <td className="py-1.5 text-xs text-stone-500">可抵扣进项 − 销项（≥0）</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-xs text-stone-400">
            口径：销项=销售出库按商品税率计算；进项=采购入库（非暂估）及暂估冲回蓝字；可抵扣进项按全部进项计（雏形）。
          </p>
        </>
      )}
    </div>
  );
}