'use client';

import { useMemo, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import { formatMoney } from '@/components/finance/balance-list';
import { useAuth } from '@/components/auth/auth-provider';
import { PaymentFormDialog } from '@/components/finance/payment-form-dialog';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import type { FinBillRow } from '@/lib/types';

interface FinBillsProps {
  kind: 'receivable' | 'payable';
}

/** 应收/应付单（物化：已出库销售订单 / 已入库采购订单）明细表格 + 按单核销 */
export function FinBills({ kind }: FinBillsProps) {
  const isReceivable = kind === 'receivable';
  const endpoint = isReceivable ? '/api/fin/ar-bills' : '/api/fin/ap-bills';
  const [searchInput, setSearchInput] = useState('');
  const [status, setStatus] = useState('');
  const list = usePagedList<FinBillRow>(endpoint, 10, { status });
  const { can } = useAuth();
  const canWrite = can('fin.write');

  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 勾选待核销单（仅未结清单）
  const openBills = useMemo(() => list.items.filter((b) => b.status === 'open'), [list.items]);
  const selectedBills = openBills.filter((b) => selected.has(b.order_id));
  const firstSelected = selectedBills[0] ?? null;
  const selectedTotal = selectedBills.reduce((s, b) => s + b.outstanding, 0);

  const [billDialog, setBillDialog] = useState<FinBillRow[] | null>(null);

  function toggle(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openReconcile(bills: FinBillRow[]): void {
    setBillDialog(bills);
  }

  const labels = isReceivable
    ? { title: '应收单（已出库销售订单）', partner: '客户', empty: '暂无应收单，销售出库后自动生成' }
    : { title: '应付单（已入库采购订单）', partner: '供应商', empty: '暂无应付单，采购入库后自动生成' };

  return (
    <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-stone-900">{labels.title}</h2>
          <p className="text-xs text-stone-500">按单核销：勾选待核销单，核销金额不可超出所选单余额</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-9 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              <SelectItem value="open">未结清</SelectItem>
              <SelectItem value="settled">已结清</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') list.setKeyword(searchInput);
            }}
            placeholder={`按单号 / ${labels.partner}搜索，回车确认`}
            className="h-9 w-full sm:w-56"
          />
          <Button variant="outline" size="sm" onClick={() => list.setKeyword(searchInput)} aria-label="搜索">
            <Search className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">搜索</span>
          </Button>
        </div>
      </div>

      {/* 按单核销工具栏 */}
      {canWrite && selectedBills.length > 0 && firstSelected && (
        <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="text-xs text-emerald-800">
            已选 {selectedBills.length} 单（{firstSelected.partner_name}），可核销合计{' '}
            <span className="font-semibold tabular-nums">¥{formatMoney(selectedTotal)}</span>
          </p>
          <Button
            size="sm"
            onClick={() => openReconcile([...selectedBills])}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            按所选核销
          </Button>
        </div>
      )}

      {list.loading ? (
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="mt-2 h-8 w-full" />
          <Skeleton className="mt-2 h-8 w-full" />
        </div>
      ) : list.total === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-8 text-center">
          <FileText className="mx-auto mb-2 h-8 w-8 text-stone-300" />
          <p className="text-sm text-stone-500">
            {list.keyword || status ? `没有符合条件的${labels.partner}单据` : labels.empty}
          </p>
        </div>
      ) : (
        <>
          {/* 移动端：卡片 */}
          <div className="grid gap-2.5 lg:hidden">
            {list.items.map((row) => (
              <div key={row.bill_no} className="rounded-lg border border-stone-200 bg-white p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {canWrite && row.status === 'open' && (
                      <Checkbox checked={selected.has(row.order_id)} onCheckedChange={() => toggle(row.order_id)} />
                    )}
                    <div className="min-w-0">
                      <div className="font-mono text-xs text-stone-500">{row.bill_no}</div>
                      <div className="mt-0.5 truncate text-sm font-medium text-stone-900">{row.partner_name}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={
                        row.status === 'settled'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-amber-200 bg-amber-50 text-amber-700'
                      }
                    >
                      {row.status === 'settled' ? '已结清' : '未结清'}
                    </Badge>
                    {canWrite && row.status === 'open' && (
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openReconcile([row])}>
                        核销
                      </Button>
                    )}
                  </div>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-stone-500">金额</dt>
                    <dd className="mt-0.5 text-stone-800 tabular-nums">¥{formatMoney(row.amount)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">已核销</dt>
                    <dd className="mt-0.5 text-stone-800 tabular-nums">¥{formatMoney(row.settled)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">余额</dt>
                    <dd
                      className={`mt-0.5 font-semibold tabular-nums ${
                        row.outstanding > 0 ? 'text-red-600' : 'text-green-700'
                      }`}
                    >
                      ¥{formatMoney(row.outstanding)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-1.5 text-xs text-stone-400 tabular-nums">{row.bill_date}</div>
              </div>
            ))}
          </div>

          {/* 桌面端：表格 */}
          <div className="hidden overflow-x-auto lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {canWrite && <TableHead className="w-10" />}
                  <TableHead>单据号</TableHead>
                  <TableHead>{labels.partner}</TableHead>
                  <TableHead>单据日期</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead className="text-right">已核销</TableHead>
                  <TableHead className="text-right">余额</TableHead>
                  <TableHead>状态</TableHead>
                  {canWrite && <TableHead className="w-16">操作</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((row) => (
                  <TableRow key={row.bill_no}>
                    {canWrite && (
                      <TableCell>
                        {row.status === 'open' && (
                          <Checkbox checked={selected.has(row.order_id)} onCheckedChange={() => toggle(row.order_id)} />
                        )}
                      </TableCell>
                    )}
                    <TableCell className="font-mono text-xs">{row.bill_no}</TableCell>
                    <TableCell className="font-medium">{row.partner_name}</TableCell>
                    <TableCell className="text-sm tabular-nums">{row.bill_date}</TableCell>
                    <TableCell className="text-right tabular-nums">¥{formatMoney(row.amount)}</TableCell>
                    <TableCell className="text-right tabular-nums">¥{formatMoney(row.settled)}</TableCell>
                    <TableCell
                      className={`text-right font-semibold tabular-nums ${
                        row.outstanding > 0 ? 'text-red-600' : 'text-green-700'
                      }`}
                    >
                      ¥{formatMoney(row.outstanding)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          row.status === 'settled'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-amber-200 bg-amber-50 text-amber-700'
                        }
                      >
                        {row.status === 'settled' ? '已结清' : '未结清'}
                      </Badge>
                    </TableCell>
                    {canWrite && (
                      <TableCell>
                        {row.status === 'open' && (
                          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => openReconcile([row])}>
                            核销
                          </Button>
                        )}
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

      {billDialog && firstSelected && canWrite && (
        <PaymentFormDialog
          open
          onOpenChange={(o) => {
            if (!o) {
              setBillDialog(null);
              setSelected(new Set());
              list.reload();
            }
          }}
          kind={isReceivable ? 'receipt' : 'payment'}
          partner={{ id: firstSelected.partner_id, code: '', name: firstSelected.partner_name }}
          outstanding={list.items.filter((b) => b.partner_id === firstSelected.partner_id).reduce((s, b) => s + b.outstanding, 0)}
          bills={billDialog}
          onSaved={() => {
            setBillDialog(null);
            setSelected(new Set());
            list.reload();
          }}
        />
      )}
    </div>
  );
}