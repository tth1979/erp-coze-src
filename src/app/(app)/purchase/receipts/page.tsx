'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Eye, Search } from 'lucide-react';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { TradeStatusBadge, RECEIPT_STATUS_OPTIONS } from '@/components/trade/trade-status-badge';
import { Badge } from '@/components/ui/badge';
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
import type { PoReceipt } from '@/lib/types';

function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 字别徽章：暂估 / 红字 / 蓝字 */
function KindBadges({ item }: { item: PoReceipt }) {
  return (
    <span className="inline-flex gap-1">
      {item.is_estimated && !item.reversal_kind ? (
        <Badge variant="outline" className="border-amber-200 bg-amber-50 font-normal text-amber-700">
          暂估
        </Badge>
      ) : null}
      {item.reversal_kind === 'red' ? (
        <Badge variant="outline" className="border-red-200 bg-red-50 font-normal text-red-700">
          红字
        </Badge>
      ) : null}
      {item.reversal_kind === 'blue' ? (
        <Badge variant="outline" className="border-blue-200 bg-blue-50 font-normal text-blue-700">
          蓝字
        </Badge>
      ) : null}
    </span>
  );
}

export default function ReceiptsPage() {
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const list = usePagedList<PoReceipt>('/api/po/receipts', 10, { status });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">采购入库单</h1>
          <p className="text-xs text-stone-500 sm:text-sm">从已审批订单创建入库单，审核通过即计入库存与成本；暂估单可冲回</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') list.setKeyword(searchInput);
          }}
          placeholder="按单号 / 发票号搜索，回车确认"
          className="h-9 w-full sm:w-72"
        />
        <Select
          value={status || 'all'}
          onValueChange={(value) => {
            list.setPage(1);
            setStatus(value === 'all' ? '' : value);
          }}
        >
          <SelectTrigger className="h-9 w-full sm:w-36">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {RECEIPT_STATUS_OPTIONS.map((opt) => (
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
            {list.keyword || status ? '没有符合条件的入库单' : '暂无入库单，可从已审批的采购订单创建'}
          </p>
        </div>
      ) : (
        <>
          {/* 移动端卡片 */}
          <div className="space-y-2.5 lg:hidden">
            {list.items.map((item) => (
              <Link key={item.id} href={`/purchase/receipts/${item.id}`} className="block rounded-lg border border-stone-200 bg-white p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium text-stone-800">{item.receipt_no}</span>
                  <span className="flex items-center gap-1">
                    <KindBadges item={item} />
                    <TradeStatusBadge status={item.status} />
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-stone-800">{item.supplier_name ?? '—'}</p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-stone-500">金额</dt>
                    <dd className="mt-0.5 font-medium tabular-nums text-stone-800">{formatMoney(item.total_amount)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">关联订单</dt>
                    <dd className="mt-0.5 font-mono text-stone-800">{item.order_no ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">入库日期</dt>
                    <dd className="mt-0.5 tabular-nums text-stone-800">{item.receive_date}</dd>
                  </div>
                </dl>
              </Link>
            ))}
          </div>

          {/* 桌面端表格 */}
          <div className="hidden overflow-x-auto rounded-lg border border-stone-200 bg-white lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>单号</TableHead>
                  <TableHead>供应商</TableHead>
                  <TableHead>关联订单</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead>字别</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>入库日期</TableHead>
                  <TableHead className="w-16 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((item) => (
                  <TableRow key={item.id} className="hover:bg-stone-50">
                    <TableCell className="font-mono text-sm">
                      <Link href={`/purchase/receipts/${item.id}`} className="text-orange-700 hover:underline">
                        {item.receipt_no}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-stone-700">{item.supplier_name ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-stone-600">{item.order_no ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(item.total_amount)}</TableCell>
                    <TableCell>
                      <KindBadges item={item} />
                    </TableCell>
                    <TableCell>
                      <TradeStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="tabular-nums text-stone-600">{item.receive_date}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8" asChild aria-label="查看详情">
                        <Link href={`/purchase/receipts/${item.id}`}>
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
        </>
      )}
    </div>
  );
}
