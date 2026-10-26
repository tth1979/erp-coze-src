'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck, Eye, Plus, Search } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { WarehouseFilterSelect } from '@/components/inventory/warehouse-select';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { CHECK_STATUS_OPTIONS, TradeStatusBadge } from '@/components/trade/trade-status-badge';
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
import type { InvCheck } from '@/lib/types';

function formatTime(value: string | null): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '—';
}

export default function ChecksPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const list = usePagedList<InvCheck>('/api/inv/checks', 10, { status, warehouse_id: warehouseId });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">库存盘点单</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            按仓库快照账面库存，录入实盘数后审批过账：盘盈入库 / 盘亏出库，差异全程可追溯
          </p>
        </div>
        {can('inv.write') ? (
          <Button size="sm" asChild>
            <Link href="/inventory/checks/new">
              <Plus className="mr-1 h-4 w-4" />
              新增盘点单
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
          placeholder="按盘点单号搜索，回车确认"
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
          <SelectTrigger className="h-9 w-full sm:w-36">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部状态</SelectItem>
            {CHECK_STATUS_OPTIONS.map((opt) => (
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
          <ClipboardCheck className="mx-auto mb-2 h-8 w-8 text-stone-300" />
          <p className="text-sm text-stone-500">
            {list.keyword || status || warehouseId ? '没有符合条件的盘点单' : '暂无盘点单'}
          </p>
          {can('inv.write') && !list.keyword && !status && !warehouseId ? (
            <Button size="sm" className="mt-3" asChild>
              <Link href="/inventory/checks/new">新增盘点单</Link>
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
                href={`/inventory/checks/${item.id}`}
                className="block rounded-lg border border-stone-200 bg-white p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium text-stone-800">{item.check_no}</span>
                  <TradeStatusBadge status={item.status} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-stone-500">盘点仓库</dt>
                    <dd className="mt-0.5 text-stone-800">{item.warehouse_name ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">创建时间</dt>
                    <dd className="mt-0.5 tabular-nums text-stone-800">{formatTime(item.created_at)}</dd>
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
                  <TableHead>盘点仓库</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead>过账时间</TableHead>
                  <TableHead className="w-16 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-mono text-xs text-stone-700">{item.check_no}</TableCell>
                    <TableCell className="text-stone-800">{item.warehouse_name ?? '—'}</TableCell>
                    <TableCell>
                      <TradeStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-stone-500">
                      {formatTime(item.created_at)}
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-stone-500">
                      {formatTime(item.approved_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" asChild>
                        <Link href={`/inventory/checks/${item.id}`} aria-label="查看详情">
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
