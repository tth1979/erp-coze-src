'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Boxes, Search } from 'lucide-react';
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
import type { StockItem } from '@/lib/types';

function formatQty(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
}

export default function StockPage() {
  const [searchInput, setSearchInput] = useState('');
  const list = usePagedList<StockItem>('/api/inv/stock', 10);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">库存余额</h1>
          <p className="text-xs text-stone-500 sm:text-sm">各商品当前库存数量，由采购到货与销售发货自动增减</p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/inventory/movements">查看库存流水</Link>
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
          <Boxes className="mx-auto mb-2 h-8 w-8 text-stone-300" />
          <p className="text-sm text-stone-500">
            {list.keyword ? '没有符合条件的库存商品' : '暂无库存记录，完成采购到货后自动生成'}
          </p>
        </div>
      ) : (
        <>
          {/* 移动端：卡片清单 */}
          <div className="grid gap-2.5 lg:hidden">
            {list.items.map((row) => {
              const out = Number(row.quantity) <= 0;
              return (
                <div key={row.product_id} className="rounded-lg border border-stone-200 bg-white p-3.5 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-stone-900">{row.product_name}</div>
                      <div className="mt-0.5 font-mono text-xs text-stone-500">{row.sku_code ?? '—'}</div>
                    </div>
                    <span
                      className={`shrink-0 text-base font-bold tabular-nums ${
                        out ? 'text-red-600' : 'text-stone-900'
                      }`}
                    >
                      {formatQty(Number(row.quantity))}
                      <span className="ml-0.5 text-xs font-normal text-stone-500">{row.unit ?? ''}</span>
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-stone-500">规格</dt>
                      <dd className="mt-0.5 text-stone-800">{row.spec ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-500">库存状态</dt>
                      <dd className={`mt-0.5 font-medium ${out ? 'text-red-600' : 'text-green-700'}`}>
                        {out ? '缺货' : '有货'}
                      </dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>

          {/* 桌面端：表格 */}
          <div className="hidden overflow-x-auto rounded-lg border border-stone-200 bg-white lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>商品编码</TableHead>
                  <TableHead>商品名称</TableHead>
                  <TableHead>规格</TableHead>
                  <TableHead className="text-right">库存数量</TableHead>
                  <TableHead>单位</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最近变动</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((row) => {
                  const qty = Number(row.quantity);
                  const out = qty <= 0;
                  return (
                    <TableRow key={row.product_id}>
                      <TableCell className="font-mono text-xs text-stone-500">{row.sku_code ?? '—'}</TableCell>
                      <TableCell className="font-medium text-stone-800">{row.product_name}</TableCell>
                      <TableCell className="text-stone-600">{row.spec ?? '—'}</TableCell>
                      <TableCell className={`text-right font-bold tabular-nums ${out ? 'text-red-600' : 'text-stone-900'}`}>
                        {formatQty(qty)}
                      </TableCell>
                      <TableCell className="text-stone-600">{row.unit ?? '—'}</TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs ${
                            out
                              ? 'border-red-600/30 bg-red-600/10 text-red-600'
                              : 'border-green-600/30 bg-green-600/10 text-green-700'
                          }`}
                        >
                          {out ? '缺货' : '有货'}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-stone-500">
                        {row.updated_at ? row.updated_at.slice(0, 16).replace('T', ' ') : '—'}
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
