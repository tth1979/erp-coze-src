'use client';

import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import type { ReportOverview } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import LineChart, { formatMoney } from '@/components/reports/line-chart';

export default function ReportOverviewPage() {
  const [report, setReport] = useState<ReportOverview | null>(null);

  useEffect(() => {
    apiFetch<ReportOverview>('/api/report/overview').then(setReport).catch(() => setReport(null));
  }, []);

  const rows: Array<{ label: string; value: number | undefined; sub: string }> = report
    ? [
        { label: '采购总额', value: report.cards.purchase_total, sub: '累计已入库' },
        { label: '销售总额', value: report.cards.sales_total, sub: '累计已出库（净额）' },
        { label: '毛利', value: report.cards.gross_profit, sub: '销售 − 出库成本' },
        { label: '库存总值', value: report.cards.inventory_value, sub: `${report.cards.inventory_kinds} 个品项` },
        { label: '应收余额', value: report.cards.receivable_outstanding, sub: '销售 − 收款' },
        { label: '应付余额', value: report.cards.payable_outstanding, sub: '采购 − 付款' },
      ]
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">经营统计汇总</h1>
          <p className="text-sm text-muted-foreground">核心指标与采购 / 销售 / 毛利趋势，可打印</p>
        </div>
        <Button variant="outline" onClick={() => window.print()} className="shrink-0 print:hidden">
          <Printer className="h-4 w-4" />
          打印
        </Button>
      </div>

      {!report ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-3">
            {rows.map((r) => (
              <Card key={r.label}>
                <CardHeader className="pb-1">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{r.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-semibold tabular-nums">{formatMoney(r.value ?? 0)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{r.sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm font-medium">近 12 个月趋势</CardTitle>
            </CardHeader>
            <CardContent>
              <LineChart
                labels={report.trends.map((t) => t.month)}
                series={[
                  { name: '采购', color: '#0284c7', values: report.trends.map((t) => t.purchase) },
                  { name: '销售', color: '#c2410c', values: report.trends.map((t) => t.sales) },
                  { name: '毛利', color: '#16a34a', values: report.trends.map((t) => t.gross_profit) },
                ]}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}