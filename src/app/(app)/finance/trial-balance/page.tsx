'use client';

import { useEffect, useState } from 'react';
import { Calendar, Scale, Search } from 'lucide-react';
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

interface TrialRow {
  subject_code: string;
  subject_name: string;
  direction: number;
  debit: number;
  credit: number;
  closing: number;
  is_leaf: boolean;
}
interface TrialData {
  period: string;
  rows: TrialRow[];
  total_debit: number;
  total_credit: number;
  balanced: boolean;
  diff: number;
}

function fmtSigned(n: number): string {
  if (n === 0) return '—';
  return `${n > 0 ? '借 ' : '贷 '}${formatMoney(Math.abs(n))}`;
}

export default function TrialBalancePage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<TrialData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/fin/trial-balance?period=${period}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? '加载失败');
      }
      setData((await res.json()) as TrialData);
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

  const rows = data?.rows ?? [];
  const balanced = data?.balanced ?? true;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-stone-900">试算平衡表</h1>
        <p className="text-xs text-stone-500 sm:text-sm">按期间汇总所有科目本期借/贷发生额，借贷合计必等（凭证引擎借贷平衡保障）</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border border-stone-200 px-2">
          <Calendar className="size-4 text-stone-400" />
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 bg-transparent text-sm outline-none" />
        </div>
        <Button variant="outline" onClick={load}>
          <Search className="size-4" />
          查询
        </Button>
        {data && (
          <Badge variant={balanced ? 'outline' : 'destructive'} className={balanced ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : ''}>
            <Scale className="size-3.5" />
            {balanced ? '借贷平衡' : `不平衡（差额 ${formatMoney(data.diff)}）`}
          </Badge>
        )}
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</div>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs text-stone-500">本期借方合计</div>
          <div className="mt-1 font-mono text-lg font-semibold text-stone-900">{formatMoney(data?.total_debit ?? 0)}</div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs text-stone-500">本期贷方合计</div>
          <div className="mt-1 font-mono text-lg font-semibold text-stone-900">{formatMoney(data?.total_credit ?? 0)}</div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs text-stone-500">差额（借−贷）</div>
          <div className={`mt-1 font-mono text-lg font-semibold ${balanced ? 'text-emerald-600' : 'text-rose-600'}`}>{formatMoney(data?.diff ?? 0)}</div>
        </div>
      </div>

      <div className="rounded-lg border border-stone-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>科目</TableHead>
              <TableHead>方向</TableHead>
              <TableHead className="text-right">本期借方</TableHead>
              <TableHead className="text-right">本期贷方</TableHead>
              <TableHead className="text-right">期末余额</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={5}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-stone-400">
                  无数据。请选择期间后查询。
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.subject_code}>
                  <TableCell>
                    <div className="font-mono text-xs">{r.subject_code}</div>
                    <div className="text-sm text-stone-700">{r.subject_name}</div>
                  </TableCell>
                  <TableCell className="text-sm">{r.direction === 0 ? '借' : '贷'}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{r.debit ? formatMoney(r.debit) : '—'}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{r.credit ? formatMoney(r.credit) : '—'}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold">{fmtSigned(r.closing)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}