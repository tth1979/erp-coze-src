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

interface BalanceLine {
  subject_code: string;
  subject_name: string;
  opening: number;
  closing: number;
  leaf: boolean;
}
interface BalanceGroup {
  key: string;
  label: string;
  direction: '借' | '贷';
  opening: number;
  closing: number;
  lines: BalanceLine[];
}
interface SheetData {
  period: string;
  groups: BalanceGroup[];
  money_fund: number;
  money_fund_opening: number;
  total_assets: number;
  total_liab_equity: number;
  balanced: boolean;
  diff: number;
  opening_assets: number;
  opening_liab_equity: number;
}

function fmtSigned(n: number): string {
  if (n === 0) return '—';
  return `${n > 0 ? '借 ' : '贷 '}${formatMoney(Math.abs(n))}`;
}

export default function BalanceSheetPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<SheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/fin/balance-sheet?period=${period}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? '加载失败');
      }
      setData((await res.json()) as SheetData);
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

  return (
    <div className="space-y-4 print:space-y-2">
      <div className="print:hidden">
        <h1 className="text-lg font-bold text-stone-900">资产负债表</h1>
        <p className="text-xs text-stone-500 sm:text-sm">按期间实时取资产/负债/所有者权益科目期末余额；资产 = 负债 + 所有者权益（结转后口径）</p>
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

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 print:hidden">{error}</div>}

      {data && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
          <span className="font-semibold text-stone-700">资产合计</span>
          <span className="font-mono text-emerald-700">{formatMoney(data.total_assets)}</span>
          <span className="text-stone-300">=</span>
          <span className="font-semibold text-stone-700">负债+所有者权益</span>
          <span className="font-mono text-emerald-700">{formatMoney(data.total_liab_equity)}</span>
          <Badge variant={data.balanced ? 'default' : 'destructive'}>
            {data.balanced ? '平衡 ✓' : `不平衡（差值 ${formatMoney(Math.abs(data.diff))}）`}
          </Badge>
          <span className="ml-auto font-mono text-xs text-stone-400">货币资金 {formatMoney(data.money_fund)}</span>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {(data?.groups ?? []).map((g) => (
          <div key={g.key} className="rounded-lg border border-stone-200 bg-white">
            <div className="flex items-center justify-between border-b border-stone-100 px-3 py-2">
              <span className="text-sm font-semibold text-stone-700">
                {g.label} <span className="ml-1 text-xs font-normal text-stone-400">（{g.direction}向）</span>
              </span>
              <span className="font-mono text-xs text-stone-500">
                期初 {fmtSigned(g.opening)} · 期末 {fmtSigned(g.closing)}
              </span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>科目</TableHead>
                  <TableHead className="text-right">期初</TableHead>
                  <TableHead className="text-right">期末</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ) : g.lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="py-4 text-center text-stone-400">无科目</TableCell>
                  </TableRow>
                ) : (
                  g.lines.map((l) => (
                    <TableRow key={l.subject_code}>
                      <TableCell>
                        <div className="font-mono text-xs text-stone-500">{l.subject_code}</div>
                        <div className="text-sm text-stone-700">{l.subject_name}</div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">{fmtSigned(l.opening)}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{fmtSigned(l.closing)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        ))}
      </div>
    </div>
  );
}