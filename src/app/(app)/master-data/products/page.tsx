'use client';

import { useState } from 'react';
import { Palette, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { usePagedList } from '@/lib/use-paged-list';
import type { Product } from '@/lib/types';
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
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { StatusBadge } from '@/components/master-data/status-badge';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import { ProductFormDialog } from '@/components/master-data/product-form-dialog';
import { ProductColorsDialog } from '@/components/master-data/product-colors-dialog';

export default function ProductsPage() {
  const { can } = useAuth();
  const writable = can('md.write');
  const list = usePagedList<Product>('/api/md/products');
  const [keywordInput, setKeywordInput] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [colorTarget, setColorTarget] = useState<Product | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">商品主数据</h1>
          <p className="text-sm text-muted-foreground">瓷砖 SKU 主数据：型号 / 规格 / 单位 / 条形码</p>
        </div>
        {writable && (
          <Button
            className="shrink-0"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">新增商品</span>
            <span className="sm:hidden">新增</span>
          </Button>
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          list.setKeyword(keywordInput);
        }}
      >
        <Input
          className="w-full sm:max-w-xs"
          placeholder="搜索编码 / 名称 / 型号 / 规格 / 条形码"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
        />
        <Button type="submit" variant="outline" className="shrink-0 px-2 sm:px-4" aria-label="搜索">
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">搜索</span>
        </Button>
      </form>

      {/* 移动端：购物车式卡片清单 */}
      <div className="space-y-2.5 lg:hidden">
        {list.loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)
        ) : list.items.length === 0 ? (
          <div className="rounded-lg border bg-card py-10 text-center text-sm text-muted-foreground">
            暂无商品数据
          </div>
        ) : (
          list.items.map((p) => (
            <div key={p.id} className="rounded-lg border border-stone-200 bg-white p-3.5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-stone-500">{p.sku_code}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="mt-1 truncate text-sm font-medium text-stone-900">{p.name}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    aria-label="色号管理"
                    onClick={() => setColorTarget(p)}
                  >
                    <Palette className="h-4 w-4" />
                  </Button>
                  {writable && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="编辑"
                        onClick={() => {
                          setEditing(p);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="删除"
                        onClick={() => setDeleteTarget(p)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <div>
                  <span className="text-stone-500">品牌：</span>
                  <span className="text-stone-800">{p.brand ?? '-'}</span>
                </div>
                <div>
                  <span className="text-stone-500">品类：</span>
                  <span className="text-stone-800">{p.category ?? '-'}</span>
                </div>
                <div>
                  <span className="text-stone-500">型号：</span>
                  <span className="text-stone-800">{p.model ?? '-'}</span>
                </div>
                <div>
                  <span className="text-stone-500">规格：</span>
                  <span className="text-stone-800">
                    {p.spec ?? '-'} / {p.unit}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-stone-100 pt-2 text-xs">
                <span className="font-mono text-[11px] text-stone-400">{p.barcode ?? ''}</span>
                <span className="text-sm font-semibold tabular-nums text-stone-900">
                  {p.reference_sale_price ? `¥${p.reference_sale_price}` : '-'}
                </span>
              </div>
            </div>
          ))
        )}
        <div className="rounded-lg border bg-card px-3">
          <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
        </div>
      </div>

      {/* 桌面端：高密度表格 */}
      <div className="hidden rounded-lg border bg-card lg:block">
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">商品编码</TableHead>
              <TableHead>名称</TableHead>
              <TableHead>型号</TableHead>
              <TableHead>规格</TableHead>
              <TableHead>单位</TableHead>
              <TableHead>条形码</TableHead>
              <TableHead>品类</TableHead>
              <TableHead className="text-right">参考售价</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="w-28 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={10}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : list.items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                  暂无商品数据
                </TableCell>
              </TableRow>
            ) : (
              list.items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-mono text-xs">{p.sku_code}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.model ?? '-'}</TableCell>
                  <TableCell>{p.spec ?? '-'}</TableCell>
                  <TableCell>{p.unit}</TableCell>
                  <TableCell className="font-mono text-xs">{p.barcode ?? '-'}</TableCell>
                  <TableCell>{p.category ?? '-'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.reference_sale_price ? `¥${p.reference_sale_price}` : '-'}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={p.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="色号管理"
                        onClick={() => setColorTarget(p)}
                      >
                        <Palette className="h-4 w-4" />
                      </Button>
                      {writable && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="编辑"
                            onClick={() => {
                              setEditing(p);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" aria-label="删除" onClick={() => setDeleteTarget(p)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="border-t px-3">
          <PaginationControls page={list.page} pageSize={list.pageSize} total={list.total} onPageChange={list.setPage} />
        </div>
      </div>

      <ProductFormDialog open={formOpen} onOpenChange={setFormOpen} initial={editing} onSaved={list.reload} />
      <ProductColorsDialog
        open={colorTarget !== null}
        onOpenChange={(open) => {
          if (!open) setColorTarget(null);
        }}
        product={colorTarget}
        readonly={!writable}
      />
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        endpoint={deleteTarget ? `/api/md/products/${deleteTarget.id}` : null}
        name={deleteTarget?.name ?? ''}
        onDeleted={list.reload}
      />
    </div>
  );
}
