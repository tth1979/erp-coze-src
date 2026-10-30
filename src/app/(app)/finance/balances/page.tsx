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

const CATEGORY_LABELS: Record<number, string> = { 1: '资产', 2: '负债', 3: '共同', 4: '权益', 5: '成本', 6: '损益' };

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface BalanceLine {
  subject_code: string;
  subject_name: string;
  category: number;
  parent_code: string | null;
  is_leaf: boolean;
  direction: number;
  balance_flag: boolean;
  status: string;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
}
interface BalanceData {
  period: string;
  rows: BalanceLine[];
}

function fmtSigned(n: number): string {
  // 正=借 负=贷
  if (n === 0) return '—';
  return `${n > 0 ? '借 ' : '贷 '}${formatMoney(Math.abs(n))}`;
}

export default function BalancesPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<BalanceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/fin/balances?period=${period}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? '加载失败');
      }
      setData((await res.json()) as BalanceData);
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-stone-900">科目余额表</h1>
        <p className="text-xs text-stone-500 sm:text-sm">按期间实时聚合已过账凭证分录：期初 + 本期借/贷 → 期末；父级科目自动汇总子级</p>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-md border border-stone-200 px-2">
          <Calendar className="size-4 text-stone-400" />
          <input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} className="h-9 bg-transparent text-sm outline-none" />
        </div>
        <Button variant="outline" onClick={load}>
          <Search className="size-4" />
          查询
        </Button>
      </div>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600">{error}</div>}

      <div className="rounded-lg border border-stone-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>科目</TableHead>
              <TableHead>类别</TableHead>
              <TableHead className="text-right">期初余额</TableHead>
              <TableHead className="text-right">本期借方</TableHead>
              <TableHead className="text-right">本期贷方</TableHead>
              <TableHead className="text-right">期末余额</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-stone-400">
                  无数据。请选择期间后查询。
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow key={r.subject_code} className={r.is_leaf ? '' : 'bg-stone-50'}>
                  <TableCell>
                    <div className="font-mono text-xs">
                      {r.subject_code}
                      {!r.is_leaf && <Badge variant="outline" className="ml-2 border-stone-200 text-stone-400">汇总</Badge>}
                    </div>
                    <div className="text-sm text-stone-700">{r.subject_name}</div>
                  </TableCell>
                  <TableCell className="text-sm">{CATEGORY_LABELS[r.category]}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{fmtSigned(r.opening)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{r.debit ? formatMoney(r.debit) : '—'}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{r.credit ? formatMoney(r.credit) : '—'}</TableCell>
                  <TableCell className={`text-right font-mono text-sm font-semibold ${r.closing !== 0 ? 'text-stone-900' : ''}`}>{fmtSigned(r.closing)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}