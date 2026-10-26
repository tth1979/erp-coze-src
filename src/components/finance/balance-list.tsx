'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { HandCoins, Search, Wallet } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { PaymentFormDialog } from '@/components/finance/payment-form-dialog';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePagedList } from '@/lib/use-paged-list';
import type { PayableRow, ReceivableRow } from '@/lib/types';

/** 归一化后的欠款聚合行（应收/应付共用渲染） */
interface BalanceRow {
  id: string;
  code: string;
  name: string;
  contact: string | null;
  phone: string | null;
  /** 应收/应付（completed 订单总额） */
  billed: number;
  /** 已收/已付 */
  settled: number;
  /** 当前欠款 */
  outstanding: number;
}

export function formatMoney(value: number): string {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface BalanceListProps {
  kind: 'receivable' | 'payable';
}

export function BalanceList({ kind }: BalanceListProps) {
  const isReceivable = kind === 'receivable';
  const endpoint = isReceivable ? '/api/fin/receivables' : '/api/fin/payables';
  const { can } = useAuth();
  const canWrite = can('fin.write');

  const [searchInput, setSearchInput] = useState('');
  const list = usePagedList<ReceivableRow | PayableRow>(endpoint, 10);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [current, setCurrent] = useState<BalanceRow | null>(null);

  const rows = useMemo<BalanceRow[]>(
    () =>
      list.items.map((item) => {
        const asReceivable = item as ReceivableRow;
        const asPayable = item as PayableRow;
        const settled = isReceivable ? asReceivable.received : asPayable.paid;
        return {
          id: isReceivable ? asReceivable.customer_id : asPayable.supplier_id,
          code: item.code,
          name: item.name,
          contact: item.contact,
          phone: item.phone,
          billed: item.billed,
          settled,
          outstanding: item.outstanding,
        };
      }),
    [list.items, isReceivable],
  );

  const labels = isReceivable
    ? { title: '应收欠款', desc: '按客户汇总：已完成销售 − 已收款 = 当前欠款', partner: '客户', billed: '应收金额', settled: '已收金额', action: '收款', empty: '暂无客户档案' }
    : { title: '应付欠款', desc: '按供应商汇总：已完成采购 − 已付款 = 当前欠款', partner: '供应商', billed: '应付金额', settled: '已付金额', action: '付款', empty: '暂无供应商档案' };

  function openDialog(row: BalanceRow) {
    setCurrent(row);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">{labels.title}</h1>
          <p className="text-xs text-stone-500 sm:text-sm">{labels.desc}</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/finance/payments">收付款流水</Link>
        </Button>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') list.setKeyword(searchInput);
          }}
          placeholder={`按${labels.partner}名称 / 编码搜索，回车确认`}
          className="h-9 w-full sm:w-72"
        />
        <Button variant="outline" size="sm" onClick={() => list.setKeyword(searchInput)} aria-label="搜索">
          <Search className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">搜索</span>
        </Button>
      </div>

      {list.loading ? (
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="mt-2 h-8 w-full" />
          <Skeleton className="mt-2 h-8 w-full" />
        </div>
      ) : list.total === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white p-8 text-center">
          <Wallet className="mx-auto mb-2 h-8 w-8 text-stone-300" />
          <p className="text-sm text-stone-500">
            {list.keyword ? `没有符合条件的${labels.partner}` : labels.empty}
          </p>
        </div>
      ) : (
        <>
          {/* 移动端：卡片清单 */}
          <div className="grid gap-2.5 lg:hidden">
            {rows.map((row) => (
              <div key={row.id} className="rounded-lg border border-stone-200 bg-white p-3.5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-stone-900">{row.name}</div>
                    <div className="mt-0.5 font-mono text-xs text-stone-500">{row.code}</div>
                  </div>
                  {canWrite && (
                    <Button
                      size="sm"
                      variant={row.outstanding > 0 ? 'default' : 'outline'}
                      disabled={row.outstanding <= 0}
                      onClick={() => openDialog(row)}
                      className="shrink-0"
                    >
                      <HandCoins className="mr-1 h-3.5 w-3.5" />
                      {labels.action}
                    </Button>
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-stone-500">{labels.billed}</dt>
                    <dd className="mt-0.5 text-stone-800 tabular-nums">¥{formatMoney(row.billed)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">{labels.settled}</dt>
                    <dd className="mt-0.5 text-stone-800 tabular-nums">¥{formatMoney(row.settled)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">当前欠款</dt>
                    <dd
                      className={`mt-0.5 font-semibold tabular-nums ${
                        row.outstanding > 0 ? 'text-red-600' : 'text-green-700'
                      }`}
                    >
                      ¥{formatMoney(row.outstanding)}
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>

          {/* 桌面端：表格 */}
          <div className="hidden overflow-x-auto rounded-lg border border-stone-200 bg-white lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>编码</TableHead>
                  <TableHead>{labels.partner}名称</TableHead>
                  <TableHead>联系方式</TableHead>
                  <TableHead className="text-right">{labels.billed}</TableHead>
                  <TableHead className="text-right">{labels.settled}</TableHead>
                  <TableHead className="text-right">当前欠款</TableHead>
                  {canWrite && <TableHead className="text-right">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-sm text-stone-600">
                      {[row.contact, row.phone].filter(Boolean).join(' · ') || '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">¥{formatMoney(row.billed)}</TableCell>
                    <TableCell className="text-right tabular-nums">¥{formatMoney(row.settled)}</TableCell>
                    <TableCell
                      className={`text-right font-semibold tabular-nums ${
                        row.outstanding > 0 ? 'text-red-600' : 'text-green-700'
                      }`}
                    >
                      ¥{formatMoney(row.outstanding)}
                    </TableCell>
                    {canWrite && (
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={row.outstanding > 0 ? 'default' : 'outline'}
                          disabled={row.outstanding <= 0}
                          onClick={() => openDialog(row)}
                        >
                          <HandCoins className="mr-1 h-3.5 w-3.5" />
                          {labels.action}
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
        </>
      )}

      <PaymentFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        kind={isReceivable ? 'receipt' : 'payment'}
        partner={current ? { id: current.id, code: current.code, name: current.name } : null}
        outstanding={current?.outstanding ?? 0}
        onSaved={list.reload}
      />
    </div>
  );
}
