'use client';

import { useCallback, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import type { ReportRow } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import BarChart, { formatMoney } from '@/components/reports/bar-chart';

interface ReportPanelProps {
  title: string;
  description: string;
  /** 报表端点前缀，如 /api/report/purchase */
  endpoint: string;
  groups: Array<{ value: string; label: string }>;
  defaultGroup: string;
}

export default function ReportPanel({ title, description, endpoint, groups, defaultGroup }: ReportPanelProps) {
  const [groupBy, setGroupBy] = useState(defaultGroup);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [items, setItems] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ groupBy });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    apiFetch<{ items: ReportRow[] }>(`${endpoint}?${params.toString()}`)
      .then((data) => setItems(data.items ?? []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [endpoint, groupBy, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const total = items.reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div className="print-area space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button variant="outline" onClick={() => window.print()} className="shrink-0 print:hidden">
          <Printer className="h-4 w-4" />
          打印
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2.5 print:hidden">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          分组维度
          <select
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {groups.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          开始日期
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-auto" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          结束日期
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-auto" />
        </label>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-baseline justify-between pb-1 print:hidden">
          <CardTitle className="text-sm font-medium">金额分布</CardTitle>
          <span className="text-xs text-muted-foreground tabular-nums">合计 {formatMoney(total)}</span>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-56 w-full" />
          ) : items.length === 0 ? (
            <div className="py-14 text-center text-sm text-muted-foreground">当前条件下暂无数据</div>
          ) : (
            <BarChart data={items.map((r) => ({ key: r.key, label: r.name, amount: r.amount, order_count: r.order_count }))} />
          )}
        </CardContent>
      </Card>

      {/* 数据明细表（可打印） */}
      <Card className="print:shadow-none">
        <CardHeader className="pb-1 print:hidden">
          <CardTitle className="text-sm font-medium">明细</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 font-medium">维度</th>
                <th className="py-2 font-medium text-right">金额</th>
                <th className="py-2 font-medium text-right">单数</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.key} className="border-b border-stone-100">
                  <td className="py-2">{r.name}</td>
                  <td className="py-2 text-right tabular-nums">{formatMoney(r.amount)}</td>
                  <td className="py-2 text-right tabular-nums">{r.order_count ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}