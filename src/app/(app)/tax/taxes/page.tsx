'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { formatMoney } from '@/components/finance/balance-list';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePagedList } from '@/lib/use-paged-list';
import { apiFetch } from '@/lib/api-client';

interface TaxSummaryRow {
  period: string;
  tax_rate: string;
  output_amount: number;
  output_base: number;
  output_tax: number;
  input_amount: number;
  input_base: number;
  input_tax: number;
}
interface TaxEntry {
  id: string;
  tax_type: string;
  period: string;
  tax_rate: string;
  amount: string;
  base_amount: string;
  tax_amount: string;
  doc_no: string | null;
  ref_type: string | null;
  ref_id: string | null;
  created_at: string;
}

export default function TaxesPage() {
  const [summary, setSummary] = useState<TaxSummaryRow[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [searchInput, setSearchInput] = useState('');
  const [taxType, setTaxType] = useState('');
  const list = usePagedList<TaxEntry>('/api/tax/entries', 10, { tax_type: taxType });

  useEffect(() => {
    let cancelled = false;
    setLoadingSummary(true);
    apiFetch<{ items: TaxSummaryRow[] }>('/api/tax/summary')
      .then((data) => {
        if (!cancelled) setSummary(data.items ?? []);
      })
      .catch((e) => {
        if (!cancelled) toast.error('税额统计加载失败', { description: (e as Error).message });
      })
      .finally(() => {
        if (!cancelled) setLoadingSummary(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold text-stone-900">税额统计</h1>
        <p className="text-xs text-stone-500 sm:text-sm">
          销项税由销售出库生成、进项税由采购入库生成，按期间(月)×税率汇总，为报税提供口径
        </p>
      </div>

      {/* 汇总表 */}
      <div className="rounded-lg border border-stone-200 bg-white">
        <div className="border-b border-stone-100 px-4 py-2 text-sm font-semibold text-stone-700">税额汇总（by 期间 × 税率）</div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>期间</TableHead>
              <TableHead>税率</TableHead>
              <TableHead className="text-right">销项含税</TableHead>
              <TableHead className="text-right">销项不含税</TableHead>
              <TableHead className="text-right">销项税额</TableHead>
              <TableHead className="text-right">进项含税</TableHead>
              <TableHead className="text-right">进项不含税</TableHead>
              <TableHead className="text-right">进项税额</TableHead>
              <TableHead className="text-right">应纳(销-进)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loadingSummary ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={9}>
                    <Skeleton className="h-5 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : summary.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-6 text-center text-stone-400">
                  暂无税额数据，业务单据终审后自动登记销项/进项税。
                </TableCell>
              </TableRow>
            ) : (
              summary.map((s, i) => (
                <TableRow key={i}>
                  <TableCell className="text-sm">{s.period}</TableCell>
                  <TableCell className="text-sm">{s.tax_rate}%</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatMoney(s.output_amount)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatMoney(s.output_base)}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-rose-600">{formatMoney(s.output_tax)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatMoney(s.input_amount)}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatMoney(s.input_base)}</TableCell>
                  <TableCell className="text-right font-mono text-sm text-emerald-600">{formatMoney(s.input_tax)}</TableCell>
                  <TableCell className={`text-right font-mono text-sm font-semibold ${s.output_tax - s.input_tax >= 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {formatMoney(s.output_tax - s.input_tax)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 明细登记 */}
      <div className="rounded-lg border border-stone-200 bg-white">
        <div className="flex flex-col gap-2 border-b border-stone-100 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-stone-700">税额登记明细</div>
          <div className="flex gap-2">
            <Input
              className="w-48"
              placeholder="搜索单号"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') list.setKeyword(searchInput);
              }}
            />
            <Button variant="outline" onClick={() => list.setKeyword(searchInput)}>
              <Search className="size-4" />
            </Button>
            <Select value={taxType} onValueChange={setTaxType}>
              <SelectTrigger className="w-32">
                <SelectValue placeholder="全部类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">全部类型</SelectItem>
                <SelectItem value="output">销项</SelectItem>
                <SelectItem value="input">进项</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>类型</TableHead>
              <TableHead>期间</TableHead>
              <TableHead>税率</TableHead>
              <TableHead>单号</TableHead>
              <TableHead className="text-right">含税金额</TableHead>
              <TableHead className="text-right">不含税金额</TableHead>
              <TableHead className="text-right">税额</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : list.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-6 text-center text-stone-400">
                  暂无明细数据
                </TableCell>
              </TableRow>
            ) : (
              list.items.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    {t.tax_type === 'output' ? (
                      <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-600">
                        销项
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                        进项
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{t.period}</TableCell>
                  <TableCell className="text-sm">{t.tax_rate}%</TableCell>
                  <TableCell className="font-mono text-xs">{t.doc_no ?? '—'}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatMoney(Number(t.amount))}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatMoney(Number(t.base_amount))}</TableCell>
                  <TableCell className="text-right font-mono text-sm">{formatMoney(Number(t.tax_amount))}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
      </div>
    </div>
  );
}