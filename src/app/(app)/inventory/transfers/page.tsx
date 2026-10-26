'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, Eye, Plus, Search } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { WarehouseFilterSelect } from '@/components/inventory/warehouse-select';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { TradeStatusBadge, TRANSFER_STATUS_OPTIONS } from '@/components/trade/trade-status-badge';
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
import type { InvTransfer } from '@/lib/types';

function formatTime(value: string | null): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '—';
}

export default function TransfersPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const list = usePagedList<InvTransfer>('/api/inv/transfers', 10, {
    status,
    from_warehouse_id: warehouseId,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">库存调拨单</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            仓库 → 仓库移库：审批通过后调出仓扣减、调入仓在途，收货确认后转为现有库存
          </p>
        </div>
        {can('inv.write') ? (
          <Button size="sm" asChild>
            <Link href="/inventory/transfers/new">
              <Plus className="mr-1 h-4 w-4" />
              新增调拨单
            </Link>
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
          placeholder="按调拨单号搜索，回车确认"
          className="h-9 w-full sm:w-64"
        />
        <WarehouseFilterSelect
          value={warehouseId}
          onChange={(v) => {
            list.setPage(1);
            setWarehouseId(v);
          }}
        />
        <Select
          value={status || 'all'}
          onValueChange={(value) => {
            list.setPage(1);
            setStatus(value === 'all' ? '' : value);
          }}
        >
          <SelectTrigger className="h-9 w-full sm:w-40">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {TRANSFER_STATUS_OPTIONS.map((opt) => (
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
          <ArrowLeftRight className="mx-auto mb-2 h-8 w-8 text-stone-300" />
          <p className="text-sm text-stone-500">
            {list.keyword || status || warehouseId ? '没有符合条件的调拨单' : '暂无调拨单'}
          </p>
          {can('inv.write') && !list.keyword && !status && !warehouseId ? (
            <Button size="sm" className="mt-3" asChild>
              <Link href="/inventory/transfers/new">新增调拨单</Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {/* 移动端卡片 */}
          <div className="grid gap-2.5 lg:hidden">
            {list.items.map((item) => (
              <Link
                key={item.id}
                href={`/inventory/transfers/${item.id}`}
                className="block rounded-lg border border-stone-200 bg-white p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium text-stone-800">{item.transfer_no}</span>
                  <TradeStatusBadge status={item.status} />
                </div>
                <p className="mt-1 text-sm text-stone-800">
                  {item.from_warehouse_name ?? '—'} → {item.to_warehouse_name ?? '—'}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-stone-500">创建时间</dt>
                    <dd className="mt-0.5 tabular-nums text-stone-800">{formatTime(item.created_at)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">收货时间</dt>
                    <dd className="mt-0.5 tabular-nums text-stone-800">{formatTime(item.received_at)}</dd>
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
                  <TableHead>调出仓</TableHead>
                  <TableHead>调入仓</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>收货时间</TableHead>
                  <TableHead className="w-16 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs text-stone-700">{item.transfer_no}</TableCell>
                    <TableCell className="text-stone-800">{item.from_warehouse_name ?? '—'}</TableCell>
                    <TableCell className="text-stone-800">{item.to_warehouse_name ?? '—'}</TableCell>
                    <TableCell>
                      <TradeStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-stone-500">
                      {formatTime(item.created_at)}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-stone-500">
                      {formatTime(item.received_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/inventory/transfers/${item.id}`} aria-label="查看详情">
                          <Eye className="h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <PaginationControls
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            onPageChange={list.setPage}
          />
        </>
      )}
    </div>
  );
}
