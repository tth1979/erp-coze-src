'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Search, Trash2, Wallet, XCircle } from 'lucide-react';
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
import { apiFetch } from '@/lib/api-client';
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

function statusBadge(status: string) {
  if (status === 'approved') {
    return (
      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
        已核销
      </Badge>
    );
  }
  if (status === 'cancelled') {
    return (
      <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-500">
        作废
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
      待核销
    </Badge>
  );
}

export default function PaymentsPage() {
  const { can } = useAuth();
  const canWrite = can('fin.write');
  const [searchInput, setSearchInput] = useState('');
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');
  const list = usePagedList<FinPayment>('/api/fin/payments', 10, { direction, status });
  const [deleteTarget, setDeleteTarget] = useState<FinPayment | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  async function apply(id: string, action: 'approve' | 'cancel') {
    const dir = list.items.find((r) => r.id === id)?.direction ?? 'receipt';
    const base = dir === 'receipt' ? 'receipts' : 'payments';
    setActingId(id);
    try {
      const res = await apiFetch<FinPayment>(`/api/fin/${base}/${id}/${action}`, { method: 'POST' });
      toast.success(action === 'approve' ? '已核销' : '已作废', { description: `单号 ${res.doc_no}` });
      list.reload?.();
    } catch (e) {
      toast.error(action === 'approve' ? '核销失败' : '作废失败', { description: (e as Error).message });
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-stone-900">收付款流水</h1>
        <p className="text-xs text-stone-500 sm:text-sm">收款/付款台账，审核核销后递减应收/应付余额；作废仅限未核销单据</p>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={direction || 'all'} onValueChange={(v) => setDirection(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-9 w-full sm:w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="receipt">收款</SelectItem>
            <SelectItem value="payment">付款</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-9 w-full sm:w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="pending">待核销</SelectItem>
            <SelectItem value="approved">已核销</SelectItem>
            <SelectItem value="cancelled">作废</SelectItem>
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
            {list.keyword || direction || status ? '没有符合条件的收付款记录' : '暂无收付款记录，可在应收/应付欠款页登记'}
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
                        {statusBadge(row.status)}
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
                      <dt className="text-stone-500">核销单号</dt>
                      <dd className="mt-0.5 font-mono text-stone-800">{row.bill_no ?? row.order_no ?? '—'}</dd>
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
                  <div className="mt-2 flex items-center justify-end gap-1.5">
                    {canWrite && row.status === 'pending' && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 border-emerald-200 text-emerald-700"
                          disabled={actingId === row.id}
                          onClick={() => apply(row.id, 'approve')}
                        >
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> 核销
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-stone-500"
                          disabled={actingId === row.id}
                          onClick={() => apply(row.id, 'cancel')}
                        >
                          <XCircle className="mr-1 h-3.5 w-3.5" /> 作废
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-stone-400 hover:text-red-600"
                          onClick={() => setDeleteTarget(row)}
                          aria-label="删除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </div>
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
                  <TableHead>状态</TableHead>
                  <TableHead>往来单位</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead>方式</TableHead>
                  <TableHead>收付日期</TableHead>
                  <TableHead>核销单号</TableHead>
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
                      <TableCell>{statusBadge(row.status)}</TableCell>
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
                      <TableCell className="font-mono text-xs">{row.bill_no ?? row.order_no ?? '—'}</TableCell>
                      <TableCell className="text-sm">{row.created_by_name ?? '—'}</TableCell>
                      <TableCell className="text-xs text-stone-500 tabular-nums">{formatTime(row.created_at)}</TableCell>
                      {canWrite && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {row.status === 'pending' && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 border-emerald-200 px-2 text-emerald-700"
                                  disabled={actingId === row.id}
                                  onClick={() => apply(row.id, 'approve')}
                                  aria-label="核销"
                                >
                                  <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> 核销
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-stone-500"
                                  disabled={actingId === row.id}
                                  onClick={() => apply(row.id, 'cancel')}
                                  aria-label="作废"
                                >
                                  <XCircle className="mr-1 h-3.5 w-3.5" /> 作废
                                </Button>
                              </>
                            )}
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