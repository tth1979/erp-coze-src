'use client';

import { useState } from 'react';
import { Search, Tags } from 'lucide-react';
import { WarehouseFilterSelect } from '@/components/inventory/warehouse-select';
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
import type { InvBatch } from '@/lib/types';

function formatQty(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
}

export default function BatchesPage() {
  const [searchInput, setSearchInput] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [inStockOnly, setInStockOnly] = useState(true);
  const list = usePagedList<InvBatch>('/api/inv/batches', 10, {
    warehouse_id: warehouseId,
    in_stock: inStockOnly ? '1' : '',
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-stone-900">批次台账</h1>
        <p className="text-xs text-stone-500 sm:text-sm">
          采购入库自动生成批次（批号 = 入库单号），出库按先进先出消耗；结余量与库存余额对账
        </p>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') list.setKeyword(searchInput);
          }}
          placeholder="按商品 / 编码 / 批号搜索，回车确认"
          className="h-9 w-full sm:w-72"
        />
        <WarehouseFilterSelect
          value={warehouseId}
          onChange={(v) => {
            list.setPage(1);
            setWarehouseId(v);
          }}
        />
        <Button variant="outline" size="sm" onClick={() => list.setKeyword(searchInput)} aria-label="搜索">
          <Search className="h-4 w-4 sm:mr-1" />
          <span className="hidden sm:inline">搜索</span>
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-stone-600 sm:ml-2">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={(e) => {
              list.setPage(1);
              setInStockOnly(e.target.checked);
            }}
            className="h-3.5 w-3.5 accent-orange-700"
          />
          仅看有结余
        </label>
      </div>

      {list.loading ? (
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="mt-2 h-8 w-full" />
          <Skeleton className="mt-2 h-8 w-full" />
        </div>
      ) : list.total === 0 ? (
        <div className="rounded-lg border border-stone-200 bg-white p-8 text-center">
          <Tags className="mx-auto mb-2 h-8 w-8 text-stone-300" />
          <p className="text-sm text-stone-500">
            {list.keyword || warehouseId ? '没有符合条件的批次记录' : '暂无批次记录，完成采购到货后自动生成'}
          </p>
        </div>
      ) : (
        <>
          {/* 移动端：卡片清单 */}
          <div className="grid gap-2.5 lg:hidden">
            {list.items.map((row) => {
              const exhausted = Number(row.remaining_quantity) <= 0;
              return (
                <div key={row.id} className="rounded-lg border border-stone-200 bg-white p-3.5 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-stone-900">{row.product_name}</div>
                      <div className="mt-0.5 font-mono text-xs text-stone-500">{row.batch_no}</div>
                    </div>
                    <span
                      className={`shrink-0 text-base font-bold tabular-nums ${
                        exhausted ? 'text-stone-400' : 'text-stone-900'
                      }`}
                    >
                      {formatQty(Number(row.remaining_quantity))}
                      <span className="ml-0.5 text-xs font-normal text-stone-500">{row.unit ?? ''}</span>
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-stone-500">仓库</dt>
                      <dd className="mt-0.5 text-stone-800">{row.warehouse_name ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-500">入库量 / 已耗</dt>
                      <dd className="mt-0.5 tabular-nums text-stone-800">
                        {formatQty(Number(row.initial_quantity))} /{' '}
                        {formatQty(Number(row.initial_quantity) - Number(row.remaining_quantity))}
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
                  <TableHead>批号（入库单号）</TableHead>
                  <TableHead>商品</TableHead>
                  <TableHead>仓库</TableHead>
                  <TableHead className="text-right">入库量</TableHead>
                  <TableHead className="text-right">已耗量</TableHead>
                  <TableHead className="text-right">结余量</TableHead>
                  <TableHead className="text-right">入库成本</TableHead>
                  <TableHead>入库时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((row) => {
                  const exhausted = Number(row.remaining_quantity) <= 0;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs text-stone-700">{row.batch_no}</TableCell>
                      <TableCell>
                        <div className="text-sm text-stone-800">{row.product_name}</div>
                        <div className="font-mono text-xs text-stone-500">{row.sku_code ?? ''}</div>
                      </TableCell>
                      <TableCell className="text-stone-600">{row.warehouse_name ?? '—'}</TableCell>
                      <TableCell className="text-right tabular-nums text-stone-700">
                        {formatQty(Number(row.initial_quantity))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-stone-700">
                        {formatQty(Number(row.initial_quantity) - Number(row.remaining_quantity))}
                      </TableCell>
                      <TableCell
                        className={`text-right font-bold tabular-nums ${
                          exhausted ? 'text-stone-400' : 'text-stone-900'
                        }`}
                      >
                        {formatQty(Number(row.remaining_quantity))}
                        <span className="ml-0.5 text-xs font-normal text-stone-400">{row.unit ?? ''}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-stone-600">
                        ¥{Number(row.unit_cost ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-stone-500">
                        {row.created_at ? row.created_at.slice(0, 16).replace('T', ' ') : '—'}
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
