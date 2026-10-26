'use client';

import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Search, Trash2, Wallet } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { METHOD_LABELS } from '@/components/finance/payment-form-dialog';
import { formatMoney } from '@/components/finance/balance-list';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
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
import type { FinPayment } from '@/lib/types';

function formatTime(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}`;
}

function partnerOf(row: FinPayment): string {
  return (row.direction === 'receipt' ? row.customer_name : row.supplier_name) ?? '—';
}

export default function PaymentsPage() {
  const { can } = useAuth();
  const canWrite = can('fin.write');
  const [searchInput, setSearchInput] = useState('');
  const [direction, setDirection] = useState('');
  const list = usePagedList<FinPayment>('/api/fin/payments', 10, { direction });
  const [deleteTarget, setDeleteTarget] = useState<FinPayment | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-stone-900">收付款流水</h1>
        <p className="text-xs text-stone-500 sm:text-sm">收款与付款台账，删除单据后对应欠款自动回升</p>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={direction || 'all'} onValueChange={(v) => setDirection(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-9 w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="receipt">收款</SelectItem>
            <SelectItem value="payment">付款</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') list.setKeyword(searchInput);
          }}
          placeholder="按单号 / 关联单号 / 往来单位搜索，回车确认"
          className="h-9 w-full sm:w-80"
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
            {list.keyword || direction ? '没有符合条件的收付款记录' : '暂无收付款记录，可在应收/应付欠款页登记'}
          </p>
        </div>
      ) : (
        <>
          {/* 移动端：卡片清单 */}
          <div className="grid gap-2.5 lg:hidden">
            {list.items.map((row) => {
              const isReceipt = row.direction === 'receipt';
              return (
                <div key={row.id} className="rounded-lg border border-stone-200 bg-white p-3.5 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={
                            isReceipt
                              ? 'border-green-200 bg-green-50 text-green-700'
                              : 'border-orange-200 bg-orange-50 text-orange-700'
                          }
                        >
                          {isReceipt ? '收款' : '付款'}
                        </Badge>
                        <span className="truncate font-mono text-xs text-stone-500">{row.doc_no}</span>
                      </div>
                      <div className="mt-1 truncate text-sm font-medium text-stone-900">{partnerOf(row)}</div>
                    </div>
                    <div className="flex shrink-0 items-start gap-1">
                      <span
                        className={`flex items-center text-base font-bold tabular-nums ${
                          isReceipt ? 'text-green-700' : 'text-orange-700'
                        }`}
                      >
                        {isReceipt ? (
                          <ArrowDownLeft className="h-4 w-4" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4" />
                        )}
                        ¥{formatMoney(row.amount)}
                      </span>
                      {canWrite && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-stone-400 hover:text-red-600"
                          onClick={() => setDeleteTarget(row)}
                          aria-label="删除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-stone-500">方式 / 日期</dt>
                      <dd className="mt-0.5 text-stone-800">
                        {METHOD_LABELS[row.method] ?? row.method} · {row.paid_at}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-stone-500">关联单号</dt>
                      <dd className="mt-0.5 font-mono text-stone-800">{row.order_no ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-500">操作人</dt>
                      <dd className="mt-0.5 text-stone-800">{row.created_by_name ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-500">备注</dt>
                      <dd className="mt-0.5 truncate text-stone-800">{row.remark ?? '—'}</dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>

          {/* 桌面端：表格 */}
          <div className="hidden overflow-x-auto rounded-lg border border-stone-200 bg-white lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>单号</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>往来单位</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead>方式</TableHead>
                  <TableHead>收付日期</TableHead>
                  <TableHead>关联单号</TableHead>
                  <TableHead>操作人</TableHead>
                  <TableHead>登记时间</TableHead>
                  {canWrite && <TableHead className="text-right">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((row) => {
                  const isReceipt = row.direction === 'receipt';
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.doc_no}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            isReceipt
                              ? 'border-green-200 bg-green-50 text-green-700'
                              : 'border-orange-200 bg-orange-50 text-orange-700'
                          }
                        >
                          {isReceipt ? '收款' : '付款'}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">{partnerOf(row)}</TableCell>
                      <TableCell
                        className={`text-right font-semibold tabular-nums ${
                          isReceipt ? 'text-green-700' : 'text-orange-700'
                        }`}
                      >
                        {isReceipt ? '+' : '-'}¥{formatMoney(row.amount)}
                      </TableCell>
                      <TableCell className="text-sm">{METHOD_LABELS[row.method] ?? row.method}</TableCell>
                      <TableCell className="text-sm tabular-nums">{row.paid_at}</TableCell>
                      <TableCell className="font-mono text-xs">{row.order_no ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.created_by_name ?? '—'}</TableCell>
                      <TableCell className="text-xs text-stone-500 tabular-nums">{formatTime(row.created_at)}</TableCell>
                      {canWrite && (
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-stone-400 hover:text-red-600"
                            onClick={() => setDeleteTarget(row)}
                            aria-label="删除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
        </>
      )}

      <DeleteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        endpoint={
          deleteTarget
            ? `/api/fin/${deleteTarget.direction === 'receipt' ? 'receipts' : 'payments'}/${deleteTarget.id}`
            : null
        }
        name={deleteTarget ? `单号 ${deleteTarget.doc_no}` : ''}
        onDeleted={list.reload}
      />
    </div>
  );
}
