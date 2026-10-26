'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Eye, Plus, Search } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { TradeStatusBadge, DOC_STATUS_OPTIONS } from '@/components/trade/trade-status-badge';
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
import type { PoRequisition } from '@/lib/types';

function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function RequisitionsPage() {
  const router = useRouter();
  const { can } = useAuth();
  const canWrite = can('po.write');
  const [status, setStatus] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const list = usePagedList<PoRequisition>('/api/po/requisitions', 10, { status });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">采购申请单</h1>
          <p className="text-xs text-stone-500 sm:text-sm">内部采购需求发起与审批，审批通过后可转采购订单</p>
        </div>
        {canWrite ? (
          <Button size="sm" onClick={() => router.push('/purchase/requisitions/new')}>
            <Plus className="mr-1 h-4 w-4" />
            新建申请单
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') list.setKeyword(searchInput);
          }}
          placeholder="按单号 / 事由搜索，回车确认"
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
            {DOC_STATUS_OPTIONS.map((opt) => (
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
          <p className="text-sm text-stone-500">{list.keyword || status ? '没有符合条件的申请单' : '暂无采购申请单'}</p>
          {canWrite && !list.keyword && !status ? (
            <Button className="mt-3" size="sm" onClick={() => router.push('/purchase/requisitions/new')}>
              <Plus className="mr-1 h-4 w-4" />
              新建第一张申请单
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          {/* 移动端卡片 */}
          <div className="space-y-2.5 lg:hidden">
            {list.items.map((item) => (
              <Link
                key={item.id}
                href={`/purchase/requisitions/${item.id}`}
                className="block rounded-lg border border-stone-200 bg-white p-3.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-medium text-stone-800">{item.req_no}</span>
                  <TradeStatusBadge status={item.status} />
                </div>
                <p className="mt-1 truncate text-sm text-stone-800">{item.reason ?? '—'}</p>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-stone-500">预估金额</dt>
                    <dd className="mt-0.5 font-medium tabular-nums text-stone-800">{formatMoney(item.total_estimate)}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">明细行</dt>
                    <dd className="mt-0.5 tabular-nums text-stone-800">{item.item_count}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">创建人</dt>
                    <dd className="mt-0.5 text-stone-800">{item.created_by_name ?? '—'}</dd>
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
                  <TableHead>事由</TableHead>
                  <TableHead className="text-right">预估金额</TableHead>
                  <TableHead className="text-right">明细行</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建人</TableHead>
                  <TableHead className="w-16 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((item) => (
                  <TableRow key={item.id} className="hover:bg-stone-50">
                    <TableCell className="font-mono text-sm">
                      <Link href={`/purchase/requisitions/${item.id}`} className="text-orange-700 hover:underline">
                        {item.req_no}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-56 truncate text-stone-700">{item.reason ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(item.total_estimate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{item.item_count}</TableCell>
                    <TableCell>
                      <TradeStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="text-stone-600">{item.created_by_name ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" className="h-8 w-8" asChild aria-label="查看详情">
                        <Link href={`/purchase/requisitions/${item.id}`}>
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
