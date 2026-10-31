'use client';

import { useEffect, useState } from 'react';
import { Calendar, Search } from 'lucide-react';
import { formatMoney } from '@/components/finance/balance-list';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface PnlRow {
  key: string;
  label: string;
  amount: number;
  prev: number;
  indent: boolean;
}
interface PnlSummary {
  revenue: number;
  cost: number;
  gross: number;
  gross_margin: number;
  tax_surcharge: number;
  selling: number;
  admin: number;
  finance: number;
  operating_profit: number;
  nonop_income: number;
  nonop_expense: number;
  profit_total: number;
  income_tax: number;
  net_profit: number;
  rebate_base: number;
}
interface PnlReport {
  period: string;
  previous: string;
  rows: PnlRow[];
  summary: PnlSummary;
}

export default function PnlPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<PnlReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/fin/pnl?period=${period}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? '加载失败');
      }
      setData((await res.json()) as PnlReport);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = data?.summary;
  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4 print:space-y-2">
      <div className="print:hidden">
        <h1 className="text-lg font-bold text-stone-900">利润表（损益表）</h1>
        <p className="text-xs text-stone-500 sm:text-sm">
          按期间实时汇总损益科目；金额为价税分离口径（销售收入科目即不含税），返点/提成基数 = 不含税收入 − 退货
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div className="flex items-center gap-1 rounded-md border border-stone-200 px-2">
          <Calendar className="size-4 text-stone-400" />
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 bg-transparent text-sm outline-none" />
        </div>
        <Button variant="outline" onClick={load}>
          <Search className="size-4" />
          查询
        </Button>
        <Button variant="ghost" className="hidden sm:inline-flex" onClick={() => window.print()}>
          打印
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 print:hidden">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:grid-cols-4">
        <Card label="营业收入" value={s?.revenue ?? 0} strong />
        <Card label="营业成本" value={s?.cost ?? 0} strong />
        <Card label="毛利（毛利率）" value={s?.gross ?? 0} suffix={s ? `${s.gross_margin}%` : ''} strong />
        <Card label="净利润" value={s?.net_profit ?? 0} strong strongColor />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:grid-cols-4 print:hidden">
        <Card label="营业利润" value={s?.operating_profit ?? 0} />
        <Card label="利润总额" value={s?.profit_total ?? 0} />
        <Card label="返点/提成基数" value={s?.rebate_base ?? 0} />
        <Card label="上期" value={Number(data?.rows[data.rows.length - 1]?.prev ?? 0)} />
      </div>

      <div className="rounded-lg border border-stone-200 bg-white">
        <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
          <span className="text-sm font-semibold text-stone-700">利润表</span>
          {data && (
            <span className="font-mono text-xs text-stone-400">
              {data.period}（对比上期 {data.previous}）
            </span>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>项目</TableHead>
              <TableHead className="text-right">本期</TableHead>
              <TableHead className="text-right hidden sm:table-cell">上期</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-stone-400">
                  无数据。请选择期间后查询。
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.key} className={r.indent ? '' : 'bg-stone-50/70'}>
                  <TableCell className={r.indent ? 'pl-8 text-sm text-stone-600' : 'text-sm font-semibold text-stone-800'}>
                    {r.label}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {r.amount ? formatMoney(r.amount) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-sm hidden sm:table-cell text-stone-500">
                    {r.prev ? formatMoney(r.prev) : '—'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function Card({ label, value, suffix, strong, strongColor }: { label: string; value: number; suffix?: string; strong?: boolean; strongColor?: boolean }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="text-xs text-stone-500">{label}</div>
      <div className={`font-mono ${strong ? 'text-base font-bold' : 'text-sm'} ${strongColor ? 'text-emerald-600' : 'text-stone-900'}`}>
        {formatMoney(value)}
        {suffix ? <span className="ml-1 text-xs text-stone-400">{suffix}</span> : null}
      </div>
    </div>
  );
}