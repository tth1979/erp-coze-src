'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BellRing, Search } from 'lucide-react';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import type { InvAlert } from '@/lib/types';

function formatQty(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
}

export default function AlertsPage() {
  const [searchInput, setSearchInput] = useState('');
  const list = usePagedList<InvAlert>('/api/inv/alerts', 10);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">库存预警</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            跨仓可用合计低于安全库存（商品主数据中维护，0 表示不预警）的商品清单
          </p>
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
          placeholder="按商品名称 / 编码搜索，回车确认"
          className="h-9 w-full sm:w-72"
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
          <BellRing className="mx-auto mb-2 h-8 w-8 text-stone-300" />
          <p className="text-sm text-stone-500">
            {list.keyword ? '没有符合条件的预警商品' : '库存健康：暂无低于安全库存的商品'}
          </p>
        </div>
      ) : (
        <>
          {/* 移动端：卡片清单 */}
          <div className="grid gap-2.5 lg:hidden">
            {list.items.map((row) => (
              <div key={row.product_id} className="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-stone-900">{row.product_name}</div>
                    <div className="mt-0.5 font-mono text-xs text-stone-500">{row.sku_code ?? '—'}</div>
                  </div>
                  <span className="shrink-0 text-base font-bold tabular-nums text-amber-700">
                    {formatQty(Number(row.total_available))}
                    <span className="ml-0.5 text-xs font-normal text-stone-500">{row.unit ?? ''}</span>
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <dt className="text-stone-500">安全库存</dt>
                    <dd className="mt-0.5 tabular-nums text-stone-800">{formatQty(Number(row.safety_stock))}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">现有合计</dt>
                    <dd className="mt-0.5 tabular-nums text-stone-800">{formatQty(Number(row.total_quantity))}</dd>
                  </div>
                  <div>
                    <dt className="text-stone-500">在途合计</dt>
                    <dd className="mt-0.5 tabular-nums text-stone-800">{formatQty(Number(row.total_in_transit))}</dd>
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
                  <TableHead>商品编码</TableHead>
                  <TableHead>商品名称</TableHead>
                  <TableHead>规格</TableHead>
                  <TableHead className="text-right">安全库存</TableHead>
                  <TableHead className="text-right">现有合计</TableHead>
                  <TableHead className="text-right">可用合计</TableHead>
                  <TableHead className="text-right">在途合计</TableHead>
                  <TableHead>缺口</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((row) => {
                  const gap = Number(row.safety_stock) - Number(row.total_available);
                  return (
                    <TableRow key={row.product_id} className="bg-amber-50/40">
                      <TableCell className="font-mono text-xs text-stone-500">{row.sku_code ?? '—'}</TableCell>
                      <TableCell className="font-medium text-stone-800">{row.product_name}</TableCell>
                      <TableCell className="text-stone-600">{row.spec ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums text-stone-700">
                        {formatQty(Number(row.safety_stock))}
                        <span className="ml-0.5 text-xs text-stone-400">{row.unit ?? ''}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-stone-700">
                        {formatQty(Number(row.total_quantity))}
                      </TableCell>
                      <TableCell className="text-right font-bold tabular-nums text-amber-700">
                        {formatQty(Number(row.total_available))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-stone-700">
                        {formatQty(Number(row.total_in_transit))}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center rounded border border-amber-600/30 bg-amber-600/10 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                          缺 {formatQty(gap)}
                          {row.unit ?? ''}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
