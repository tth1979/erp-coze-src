'use client';

import { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, Search, XCircle } from 'lucide-react';
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

interface Section {
  key: string;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
  lines: { label: string; inflow: number; outflow: number; net: number }[];
}
interface IndirectItem {
  label: string;
  amount: number;
}
interface CashFlowReport {
  period: string;
  direct: { sections: Section[]; net_change: number };
  indirect: {
    net_profit: number;
    items: IndirectItem[];
    operating_net: number;
    investing_net: number;
    financing_net: number;
    net_change: number;
  };
  money_fund_opening: number;
  money_fund_closing: number;
  methods_equal: boolean;
  diff: number;
}

export default function CashFlowPage() {
  const [period, setPeriod] = useState(currentPeriod());
  const [data, setData] = useState<CashFlowReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'direct' | 'indirect'>('direct');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/fin/cash-flow?period=${period}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { message?: string }).message ?? '加载失败');
      }
      setData((await res.json()) as CashFlowReport);
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
        <h1 className="text-lg font-bold text-stone-900">现金流量表</h1>
        <p className="text-xs text-stone-500 sm:text-sm">
          按期间实时汇总货币资金凭证；直接法与间接法净增加额强制相等（FR-FIN-024）
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <div className="flex items-center gap-1 rounded-md border border-stone-200 px-2">
          <Calendar className="size-4 text-stone-400" />
          <input
            type="month"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            className="h-9 bg-transparent text-sm outline-none"
          />
        </div>
        <Button variant="outline" onClick={load}>
          <Search className="size-4" />
          查询
        </Button>
        <div className="flex overflow-hidden rounded-md border border-stone-200">
          <button
            type="button"
            onClick={() => setMode('direct')}
            className={`px-3 py-1.5 text-sm ${mode === 'direct' ? 'bg-stone-800 text-white' : 'bg-white text-stone-600'}`}
          >
            直接法
          </button>
          <button
            type="button"
            onClick={() => setMode('indirect')}
            className={`px-3 py-1.5 text-sm ${mode === 'indirect' ? 'bg-stone-800 text-white' : 'bg-white text-stone-600'}`}
          >
            间接法
          </button>
        </div>
        <Button variant="ghost" className="hidden sm:inline-flex" onClick={() => window.print()}>
          打印
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-600 print:hidden">{error}</div>
      )}

      {data && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs">
          <span className="text-stone-500">
            期初货币资金 <span className="font-mono text-stone-800">¥{formatMoney(data.money_fund_opening)}</span>
          </span>
          <span className="text-stone-500">
            期末货币资金 <span className="font-mono text-stone-800">¥{formatMoney(data.money_fund_closing)}</span>
          </span>
          <span className="text-stone-500">
            直接法净增加额 <span className="font-mono text-stone-800">¥{formatMoney(data.direct.net_change)}</span>
          </span>
          <span className="text-stone-500">
            间接法净增加额 <span className="font-mono text-stone-800">¥{formatMoney(data.indirect.net_change)}</span>
          </span>
          {data.methods_equal ? (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="mr-1 size-3.5" /> 两法恒等
            </Badge>
          ) : (
            <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">
              <XCircle className="mr-1 size-3.5" /> 差额 ¥{formatMoney(data.diff)}
            </Badge>
          )}
        </div>
      )}

      {mode === 'direct' ? (
        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="border-b border-stone-100 px-3 py-2 text-sm font-semibold text-stone-700">
            直接法现金流量表 {data ? `（${data.period}）` : ''}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>项目</TableHead>
                <TableHead className="text-right">流入</TableHead>
                <TableHead className="text-right hidden sm:table-cell">流出</TableHead>
                <TableHead className="text-right">净额</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={4}><Skeleton className="h-6 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : !data || data.direct.sections.every((s) => s.inflow === 0 && s.outflow === 0) ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-stone-400">
                    无现金流量数据。请选择期间后查询。
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {data.direct.sections.map((s) => (
                    <TableRow key={s.key} className="bg-stone-50/70">
                      <TableCell className="text-sm font-semibold text-stone-800">{s.label}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{s.inflow ? formatMoney(s.inflow) : '—'}</TableCell>
                      <TableCell className="text-right font-mono text-sm hidden sm:table-cell">
                        {s.outflow ? formatMoney(s.outflow) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold">{formatMoney(s.net)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell className="text-sm font-bold text-stone-900">现金及现金等价物净增加额</TableCell>
                    <TableCell />
                    <TableCell className="hidden sm:table-cell" />
                    <TableCell className="text-right font-mono text-sm font-bold text-emerald-700">
                      {formatMoney(data.direct.net_change)}
                    </TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-lg border border-stone-200 bg-white">
          <div className="border-b border-stone-100 px-3 py-2 text-sm font-semibold text-stone-700">
            间接法（净利润调节表）{data ? `（${data.period}）` : ''}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>项目</TableHead>
                <TableHead className="text-right">金额</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading || !data ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={2}><Skeleton className="h-6 w-full" /></TableCell>
                  </TableRow>
                ))
              ) : (
                <>
                  <TableRow>
                    <TableCell className="text-sm font-semibold text-stone-800">净利润</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatMoney(data.indirect.net_profit)}</TableCell>
                  </TableRow>
                  {data.indirect.items.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-8 text-sm text-stone-600">{it.label}</TableCell>
                      <TableCell className="text-right font-mono text-sm">{formatMoney(it.amount)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-stone-50/70">
                    <TableCell className="text-sm font-semibold text-stone-800">经营活动产生的现金流量净额</TableCell>
                    <TableCell className="text-right font-mono text-sm font-semibold">{formatMoney(data.indirect.operating_net)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm text-stone-600">投资活动产生的现金流量净额</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatMoney(data.indirect.investing_net)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm text-stone-600">筹资活动产生的现金流量净额</TableCell>
                    <TableCell className="text-right font-mono text-sm">{formatMoney(data.indirect.financing_net)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-sm font-bold text-stone-900">现金及现金等价物净增加额</TableCell>
                    <TableCell className="text-right font-mono text-sm font-bold text-emerald-700">
                      {formatMoney(data.indirect.net_change)}
                    </TableCell>
                  </TableRow>
                </>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
