'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, RefreshCw, Search } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import type { CreditBoardRow, CreditDetail } from '@/lib/types';

function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_META: Record<string, { label: string; dot: string; badge: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  green: { label: '正常', dot: 'bg-emerald-500', badge: 'outline' },
  yellow: { label: '关注', dot: 'bg-amber-500', badge: 'secondary' },
  red: { label: '风险', dot: 'bg-red-500', badge: 'destructive' },
};

function CreditStatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.green;
  return (
    <Badge variant={meta.badge} className="gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-full ${meta.dot}`} />
      {meta.label}
    </Badge>
  );
}

export default function CreditBoardPage() {
  const [items, setItems] = useState<CreditBoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [details, setDetails] = useState<Map<string, CreditDetail>>(new Map());
  const [detailLoading, setDetailLoading] = useState<string | null>(null);

  const load = useCallback((kw: string) => {
    setLoading(true);
    const params = kw ? `?keyword=${encodeURIComponent(kw)}` : '';
    apiFetch<{ items: CreditBoardRow[] }>(`/api/sales/credit${params}`)
      .then((data) => setItems(data.items))
      .catch((error: unknown) => toast.error(error instanceof ApiClientError ? error.message : '加载失败'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(keyword);
  }, [load, keyword]);

  function toggleExpand(customerId: string) {
    if (expanded === customerId) {
      setExpanded(null);
      return;
    }
    setExpanded(customerId);
    if (details.has(customerId)) return;
    setDetailLoading(customerId);
    apiFetch<CreditDetail>(`/api/sales/credit/${customerId}`)
      .then((detail) => setDetails((prev) => new Map(prev).set(customerId, detail)))
      .catch((error: unknown) => toast.error(error instanceof ApiClientError ? error.message : '应收明细加载失败'))
      .finally(() => setDetailLoading(null));
  }

  const riskCount = items.filter((i) => i.status === 'red').length;
  const warnCount = items.filter((i) => i.status === 'yellow').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">客户信用看板</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            可用额度 = 信用额度 −（应收未结 + 已确认未出库订单占用）；逾期按信用账期逐单核算
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(keyword)}>
          <RefreshCw className="mr-1 h-4 w-4" />
          刷新
        </Button>
      </div>

      {/* 汇总条 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <p className="text-xs text-stone-500">管控客户</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-stone-900">{items.filter((i) => i.enabled).length}</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <p className="text-xs text-stone-500">应收未结合计</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-stone-900">
            {formatMoney(items.reduce((s, i) => s + i.ar_outstanding, 0))}
          </p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <p className="text-xs text-stone-500">风险客户（红）</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-red-600">{riskCount}</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-3">
          <p className="text-xs text-stone-500">关注客户（黄）</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-amber-600">{warnCount}</p>
        </div>
      </div>

      {/* 搜索 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setKeyword(searchInput.trim());
          }}
          placeholder="按客户名称 / 编码搜索，回车确认"
          className="h-9 w-full sm:w-72"
        />
        <Button variant="outline" size="sm" onClick={() => setKeyword(searchInput.trim())} aria-label="搜索">
          <Search className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">搜索</span>
        </Button>
      </div>

      {loading ? (
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="mt-2 h-8 w-full" />
          <Skeleton className="mt-2 h-8 w-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white p-8 text-center">
          <p className="text-sm text-stone-500">{keyword ? '没有符合条件的客户' : '暂无启用状态的客户'}</p>
        </div>
      ) : (
        <div className="rounded-lg border border-stone-200 bg-white shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>客户</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">信用额度</TableHead>
                <TableHead className="text-right">应收未结</TableHead>
                <TableHead className="text-right">在途占用</TableHead>
                <TableHead className="text-right">已用</TableHead>
                <TableHead className="text-right">可用</TableHead>
                <TableHead className="text-right">使用率</TableHead>
                <TableHead className="text-right">逾期金额</TableHead>
                <TableHead className="text-right">最长逾期</TableHead>
                <TableHead className="text-right">明细</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((row) => (
                <CreditRow
                  key={row.customer_id}
                  row={row}
                  expanded={expanded === row.customer_id}
                  detail={details.get(row.customer_id) ?? null}
                  detailLoading={detailLoading === row.customer_id}
                  onToggle={() => toggleExpand(row.customer_id)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function CreditRow({
  row,
  expanded,
  detail,
  detailLoading,
  onToggle,
}: {
  row: CreditBoardRow;
  expanded: boolean;
  detail: CreditDetail | null;
  detailLoading: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <TableRow className="cursor-pointer" onClick={onToggle}>
        <TableCell>
          <div className="text-sm font-medium text-stone-900">{row.name}</div>
          <div className="font-mono text-xs text-stone-500">{row.code}</div>
        </TableCell>
        <TableCell>
          <CreditStatusBadge status={row.enabled ? row.status : 'green'} />
          {!row.enabled ? <span className="ml-1 text-xs text-stone-400">未管控</span> : null}
        </TableCell>
        <TableCell className="text-right tabular-nums">{row.enabled ? formatMoney(row.credit_limit) : '—'}</TableCell>
        <TableCell className="text-right tabular-nums">{formatMoney(row.ar_outstanding)}</TableCell>
        <TableCell className="text-right tabular-nums">{formatMoney(row.order_hold)}</TableCell>
        <TableCell className="text-right tabular-nums">{formatMoney(row.used)}</TableCell>
        <TableCell className={`text-right tabular-nums ${row.enabled && row.available < 0 ? 'font-semibold text-red-600' : ''}`}>
          {row.enabled ? formatMoney(row.available) : '—'}
        </TableCell>
        <TableCell className="text-right tabular-nums">{row.usage_rate === null ? '—' : `${row.usage_rate}%`}</TableCell>
        <TableCell className={`text-right tabular-nums ${row.overdue_amount > 0 ? 'font-semibold text-red-600' : ''}`}>
          {formatMoney(row.overdue_amount)}
        </TableCell>
        <TableCell className="text-right tabular-nums">{row.overdue_max_days > 0 ? `${row.overdue_max_days} 天` : '—'}</TableCell>
        <TableCell className="text-right">
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={expanded ? '收起' : '展开'}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </TableCell>
      </TableRow>
      {expanded ? (
        <TableRow>
          <TableCell colSpan={11} className="bg-stone-50 p-0">
            <div className="px-6 py-3">
              {detailLoading ? (
                <Skeleton className="h-16 w-full" />
              ) : detail && detail.bills.length > 0 ? (
                <>
                  <p className="mb-2 text-xs font-medium text-stone-500">
                    应收未结明细（{detail.bills.length} 笔；账期 {row.credit_days > 0 ? `${row.credit_days} 天` : '未设置'}）
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>单据号</TableHead>
                        <TableHead>出库日期</TableHead>
                        <TableHead className="text-right">应收金额</TableHead>
                        <TableHead className="text-right">已核销</TableHead>
                        <TableHead className="text-right">未结余额</TableHead>
                        <TableHead>到期日</TableHead>
                        <TableHead className="text-right">逾期天数</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.bills.map((bill) => (
                        <TableRow key={bill.order_id}>
                          <TableCell className="font-mono text-xs">{bill.bill_no}</TableCell>
                          <TableCell className="text-stone-600">{bill.bill_date}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(bill.amount)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatMoney(bill.settled)}</TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{formatMoney(bill.outstanding)}</TableCell>
                          <TableCell className="text-stone-600">{bill.due_date ?? '—'}</TableCell>
                          <TableCell className={`text-right tabular-nums ${bill.overdue_days > 0 ? 'font-semibold text-red-600' : ''}`}>
                            {bill.overdue_days > 0 ? `${bill.overdue_days} 天` : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </>
              ) : (
                <p className="text-xs text-stone-500">该客户当前无应收未结单据</p>
              )}
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
