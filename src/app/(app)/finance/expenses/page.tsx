'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Receipt, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { formatMoney } from '@/components/finance/balance-list';
import { ExpenseFormDialog, type ExpenseClaimDetail } from '@/components/finance/expense-form-dialog';
import { ExpenseDetailSheet } from '@/components/finance/expense-detail-sheet';
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

interface ExpenseClaimRow {
  id: string;
  claim_no: string;
  applicant: string;
  dept: string | null;
  claim_date: string;
  period: string;
  status: string;
  total_amount: number;
  excl_amount: number;
  tax_amount: number;
  voucher_no: string | null;
  payment_id: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  pending: '待审核',
  approved: '已审核',
  paid: '已付款',
  rejected: '已驳回',
};

function statusBadge(status: string) {
  const label = STATUS_LABEL[status] ?? status;
  if (status === 'paid') {
    return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">{label}</Badge>;
  }
  if (status === 'approved') {
    return <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">{label}</Badge>;
  }
  if (status === 'pending') {
    return <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">{label}</Badge>;
  }
  if (status === 'rejected') {
    return <Badge variant="outline" className="border-rose-200 bg-rose-50 text-rose-700">{label}</Badge>;
  }
  return <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-500">{label}</Badge>;
}

export default function ExpensesPage() {
  const { can } = useAuth();
  const canWrite = can('fin.write');
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  const list = usePagedList<ExpenseClaimRow>('/api/fin/expenses', 10, { status });
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExpenseClaimRow | null>(null);

  function handleSaved(_: ExpenseClaimDetail) {
    setCreateOpen(false);
    list.reload();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">费用报销</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            报销单审批通过后自动生成费用凭证（借费用科目 / 贷其他应付款），付款后登记付款并生成付款凭证
          </p>
        </div>
        {canWrite && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            新建报销单
          </Button>
        )}
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-9 w-full sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            <SelectItem value="draft">草稿</SelectItem>
            <SelectItem value="pending">待审核</SelectItem>
            <SelectItem value="approved">已审核</SelectItem>
            <SelectItem value="paid">已付款</SelectItem>
            <SelectItem value="rejected">已驳回</SelectItem>
          </SelectContent>
        </Select>
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') list.setKeyword(searchInput);
          }}
          placeholder="按单号 / 报销人搜索，回车确认"
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
          <Receipt className="mx-auto mb-2 h-8 w-8 text-stone-300" />
          <p className="text-sm text-stone-500">
            {list.keyword || status ? '没有符合条件的报销单' : '暂无报销单，点击右上角新建'}
          </p>
        </div>
      ) : (
        <>
          {/* 移动端：卡片清单 */}
          <div className="grid gap-2.5 lg:hidden">
            {list.items.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => setDetailId(row.id)}
                className="rounded-lg border border-stone-200 bg-white p-3.5 text-left shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-xs text-stone-500">{row.claim_no}</span>
                      {statusBadge(row.status)}
                    </div>
                    <div className="mt-1 truncate text-sm font-medium text-stone-900">{row.applicant}</div>
                  </div>
                  <span className="shrink-0 text-base font-bold tabular-nums text-stone-900">
                    ¥{formatMoney(row.total_amount)}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-stone-500">部门 / 日期</dt>
                    <dd className="mt-0.5 text-stone-800">{row.dept ?? '—'} · {row.claim_date}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">不含税 / 税额</dt>
                    <dd className="mt-0.5 tabular-nums text-stone-800">
                      {formatMoney(row.excl_amount)} / {formatMoney(row.tax_amount)}
                    </dd>
                  </div>
                </dl>
              </button>
            ))}
          </div>

          {/* 桌面端：表格 */}
          <div className="hidden overflow-x-auto rounded-lg border border-stone-200 bg-white lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>单号</TableHead>
                  <TableHead>报销人</TableHead>
                  <TableHead>部门</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">含税金额</TableHead>
                  <TableHead className="text-right">不含税</TableHead>
                  <TableHead className="text-right">税额</TableHead>
                  <TableHead>凭证号</TableHead>
                  <TableHead>报销日期</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.claim_no}</TableCell>
                    <TableCell className="font-medium">{row.applicant}</TableCell>
                    <TableCell className="text-sm">{row.dept ?? '—'}</TableCell>
                    <TableCell>{statusBadge(row.status)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">¥{formatMoney(row.total_amount)}</TableCell>
                    <TableCell className="text-right tabular-nums text-stone-600">{formatMoney(row.excl_amount)}</TableCell>
                    <TableCell className="text-right tabular-nums text-stone-600">{formatMoney(row.tax_amount)}</TableCell>
                    <TableCell className="font-mono text-xs">{row.voucher_no ?? '—'}</TableCell>
                    <TableCell className="text-sm tabular-nums">{row.claim_date}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setDetailId(row.id)}>
                          详情
                        </Button>
                        {canWrite && row.status === 'draft' && (
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
        </>
      )}

      <ExpenseFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={handleSaved}
      />

      <ExpenseDetailSheet
        expenseId={detailId}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        onChanged={list.reload}
      />

      <DeleteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        endpoint={deleteTarget ? `/api/fin/expenses/${deleteTarget.id}` : null}
        name={deleteTarget ? `报销单 ${deleteTarget.claim_no}` : ''}
        onDeleted={list.reload}
      />
    </div>
  );
}
