'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowDownCircle, ArrowUpCircle, ListOrdered, Search, SlidersHorizontal } from 'lucide-react';
import { PaginationControls } from '@/components/master-data/pagination-controls';
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
import type { StockMovement } from '@/lib/types';

const TYPE_OPTIONS = [
  { value: 'all', label: '全部类型' },
  { value: 'in', label: '入库' },
  { value: 'out', label: '出库' },
  { value: 'adjust', label: '盘点调整' },
];

const SOURCE_LABEL: Record<string, string> = {
  purchase_in: '采购到货',
  sales_out: '销售发货',
  manual: '手工调整',
};

function formatQty(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
}

function formatTime(value: string): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '—';
}

/** 流水方向展示：正=入库（绿+上箭头），负=出库（红+下箭头） */
function MovementSign({ type, quantity }: { type: string; quantity: number }) {
  const isIn = quantity >= 0;
  const Icon = isIn ? ArrowUpCircle : ArrowDownCircle;
  const color =
    type === 'adjust'
      ? isIn
        ? 'text-green-700'
        : 'text-amber-600'
      : isIn
        ? 'text-green-700'
        : 'text-red-600';
  return (
    <span className={`inline-flex items-center gap-1 font-medium tabular-nums ${color}`}>
      <Icon className="h-4 w-4" />
      {isIn ? '+' : ''}
      {formatQty(quantity)}
    </span>
  );
}

export default function MovementsPage() {
  const [type, setType] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const list = usePagedList<StockMovement>('/api/inv/movements', 10, { type });

  function onTypeChange(value: string) {
    list.setPage(1);
    setType(value === 'all' ? '' : value);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">库存流水</h1>
          <p className="text-xs text-stone-500 sm:text-sm">出入库台账（只追加不改写），可按商品 / 单号追溯</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/inventory/stock">查看库存余额</Link>
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
          placeholder="按商品名称 / 编码 / 关联单号搜索，回车确认"
          className="h-9 w-full sm:w-80"
        />
        <Select value={type || 'all'} onValueChange={onTypeChange}>
          <SelectTrigger className="h-9 w-full sm:w-36">
            <SlidersHorizontal className="h-3.5 w-3.5 text-stone-400" />
            <SelectValue placeholder="全部类型" />
          </SelectTrigger>
          <SelectContent>
            {TYPE_OPTIONS.map((opt) => (
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
          <ListOrdered className="mx-auto mb-2 h-8 w-8 text-stone-300" />
          <p className="text-sm text-stone-500">
            {list.keyword || type ? '没有符合条件的流水记录' : '暂无库存流水，完成采购到货或销售发货后自动记录'}
          </p>
        </div>
      ) : (
        <>
          {/* 移动端：卡片清单 */}
          <div className="grid gap-2.5 lg:hidden">
            {list.items.map((mv) => (
              <div key={mv.id} className="rounded-lg border border-stone-200 bg-white p-3.5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-stone-900">{mv.product_name}</div>
                    <div className="mt-0.5 font-mono text-xs text-stone-500">{mv.sku_code ?? '—'}</div>
                  </div>
                  <MovementSign type={mv.type} quantity={Number(mv.quantity)} />
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-stone-500">来源</dt>
                    <dd className="mt-0.5 text-stone-800">{SOURCE_LABEL[mv.source] ?? mv.source}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">变动后余额</dt>
                    <dd className="mt-0.5 tabular-nums text-stone-800">
                      {formatQty(Number(mv.balance))}
                      {mv.unit ?? ''}
                    </dd>
                  </div>
                  {mv.ref_no ? (
                    <div className="col-span-2">
                      <dt className="text-stone-500">关联单号</dt>
                      <dd className="mt-0.5 font-mono text-stone-800">{mv.ref_no}</dd>
                    </div>
                  ) : null}
                  <div className="col-span-2">
                    <dt className="text-stone-500">时间</dt>
                    <dd className="mt-0.5 tabular-nums text-stone-600">{formatTime(mv.created_at)}</dd>
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
                  <TableHead>时间</TableHead>
                  <TableHead>商品</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead className="text-right">变动数量</TableHead>
                  <TableHead className="text-right">变动后余额</TableHead>
                  <TableHead>来源</TableHead>
                  <TableHead>关联单号</TableHead>
                  <TableHead>操作人</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((mv) => (
                  <TableRow key={mv.id}>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-stone-500">
                      {formatTime(mv.created_at)}
                    </TableCell>
                    <TableCell>
                      <div className="text-sm text-stone-800">{mv.product_name}</div>
                      <div className="font-mono text-xs text-stone-500">{mv.sku_code ?? ''}</div>
                    </TableCell>
                    <TableCell>
                      <MovementSign type={mv.type} quantity={Number(mv.quantity)} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-stone-700">
                      {formatQty(Number(mv.balance))}
                      <span className="ml-0.5 text-xs text-stone-400">{mv.unit ?? ''}</span>
                    </TableCell>
                    <TableCell className="text-stone-600">{SOURCE_LABEL[mv.source] ?? mv.source}</TableCell>
                    <TableCell className="font-mono text-xs text-stone-600">{mv.ref_no ?? '—'}</TableCell>
                    <TableCell className="text-stone-600">{mv.created_by_name ?? '—'}</TableCell>
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
