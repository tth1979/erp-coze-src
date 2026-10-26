'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import { TradeStatusBadge, TRADE_STATUS_OPTIONS } from '@/components/trade/trade-status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import type { SalesOrder } from '@/lib/types';

function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function SalesOrdersPage() {
  const router = useRouter();
  const { can } = useAuth();
  const canWrite = can('so.write');
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const list = usePagedList<SalesOrder>('/api/so/orders', 10, { status });
  const [deleteTarget, setDeleteTarget] = useState<SalesOrder | null>(null);

  function onStatusChange(value: string) {
    list.setPage(1);
    setStatus(value === 'all' ? '' : value);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">销售订单</h1>
          <p className="text-xs text-stone-500 sm:text-sm">向客户开具销售单，跟踪确认与执行状态</p>
        </div>
        {canWrite ? (
          <Button size="sm" onClick={() => router.push('/sales/orders/new')}>
            <Plus className="mr-1 h-4 w-4" />
            新建销售订单
          </Button>
        ) : null}
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') list.setKeyword(searchInput);
          }}
          placeholder="按单号 / 备注搜索，回车确认"
          className="h-9 w-full sm:w-72"
        />
        <Select value={status || 'all'} onValueChange={onStatusChange}>
          <SelectTrigger className="h-9 w-full sm:w-36">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {TRADE_STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          <p className="text-sm text-stone-500">
            {list.keyword || status ? '没有符合条件的销售订单' : '暂无销售订单'}
          </p>
          {canWrite && !list.keyword && !status ? (
            <Button className="mt-3" size="sm" onClick={() => router.push('/sales/orders/new')}>
              <Plus className="mr-1 h-4 w-4" />
              新建第一张订单
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {/* 移动端：购物车式卡片清单 */}
          <div className="grid gap-2.5 lg:hidden">
            {list.items.map((order) => (
              <div key={order.id} className="rounded-lg border border-stone-200 bg-white p-3.5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-stone-500">{order.order_no}</span>
                      <TradeStatusBadge status={order.status} />
                    </div>
                    <div className="mt-0.5 truncate text-sm font-medium text-stone-900">
                      {order.customer_name ?? '—'}
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                      <Link href={`/sales/orders/${order.id}`} aria-label="查看">
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                    {canWrite && order.status === 'draft' ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => setDeleteTarget(order)}
                        aria-label="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  <div className="flex justify-between gap-2">
                    <dt className="text-stone-500">下单日期</dt>
                    <dd className="text-stone-800">{order.order_date}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-stone-500">明细行</dt>
                    <dd className="text-stone-800">{order.item_count} 行</dd>
                  </div>
                </dl>
                <div className="mt-2.5 flex items-center justify-between border-t border-stone-100 pt-2.5">
                  <span className="text-xs text-stone-500">订单总额</span>
                  <span className="text-sm font-semibold tabular-nums text-stone-900">
                    {formatMoney(order.total_amount)}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* 桌面端：高密度表格 */}
          <div className="hidden rounded-lg border border-stone-200 bg-white shadow-sm lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>单号</TableHead>
                  <TableHead>客户</TableHead>
                  <TableHead>下单日期</TableHead>
                  <TableHead className="text-center">明细</TableHead>
                  <TableHead className="text-right">总额</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建人</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((order) => (
                  <TableRow
                    key={order.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/sales/orders/${order.id}`)}
                  >
                    <TableCell className="font-mono text-xs">{order.order_no}</TableCell>
                    <TableCell>{order.customer_name ?? '—'}</TableCell>
                    <TableCell className="text-stone-600">{order.order_date}</TableCell>
                    <TableCell className="text-center text-stone-600">{order.item_count}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(order.total_amount)}
                    </TableCell>
                    <TableCell>
                      <TradeStatusBadge status={order.status} />
                    </TableCell>
                    <TableCell className="text-stone-600">{order.created_by_name ?? '—'}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
                          <Link href={`/sales/orders/${order.id}`} aria-label="查看">
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        {canWrite && order.status === 'draft' ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => setDeleteTarget(order)}
                            aria-label="删除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="rounded-lg border border-stone-200 bg-white shadow-sm">
            <PaginationControls
              page={list.page}
              pageSize={list.pageSize}
              total={list.total}
              onPageChange={list.setPage}
            />
          </div>
        </>
      )}

      <DeleteConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        endpoint={deleteTarget ? `/api/so/orders/${deleteTarget.id}` : null}
        name={deleteTarget?.order_no ?? ''}
        onDeleted={list.reload}
      />
    </div>
  );
}
