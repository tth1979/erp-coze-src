'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Boxes, Lock, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth/auth-provider';
import { WarehouseFilterSelect } from '@/components/inventory/warehouse-select';
import { PaginationControls } from '@/components/master-data/pagination-controls';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { usePagedList } from '@/lib/use-paged-list';
import type { StockItem } from '@/lib/types';

function formatQty(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
}

/** 冻结/解冻对话框：delta 正数=冻结，负数=解冻（不超现有量/已冻量，由服务端校验） */
function FreezeDialog({
  row,
  open,
  onOpenChange,
  onDone,
}: {
  row: StockItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [delta, setDelta] = useState('');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!row) return;
    const value = Number(delta);
    if (!Number.isFinite(value) || value === 0) {
      toast.error('请输入非零的冻结调整数量（正数冻结 / 负数解冻）');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/inv/stock/freeze', {
        method: 'POST',
        body: JSON.stringify({
          warehouse_id: row.warehouse_id,
          product_id: row.product_id,
          color_code: row.color_code || '',
          delta: value,
          remark: remark.trim() || undefined,
        }),
      });
      toast.success(value > 0 ? '已冻结' : '已解冻');
      onOpenChange(false);
      setDelta('');
      setRemark('');
      onDone();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '操作失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>冻结 / 解冻库存</DialogTitle>
          <DialogDescription>
            {row
              ? `${row.product_name}${row.color_name ? ` · ${row.color_name}` : ''} @ ${row.warehouse_name ?? '默认仓'}`
              : ''}
            ，当前可用 {row ? formatQty(Number(row.available)) : '—'}
            {row?.unit ?? ''}，已冻结 {row ? formatQty(Number(row.frozen_quantity)) : '—'}
            {row?.unit ?? ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="freeze-delta">调整数量</Label>
            <Input
              id="freeze-delta"
              type="number"
              step="any"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="正数 = 冻结，负数 = 解冻"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="freeze-remark">备注</Label>
            <Input
              id="freeze-remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="选填，如质检锁定 / 解冻放行"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? '提交中…' : '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function StockPage() {
  const { can } = useAuth();
  const canWrite = can('inv.write');
  const [searchInput, setSearchInput] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [colorCode, setColorCode] = useState('');
  const [colorInput, setColorInput] = useState('');
  const [freezeTarget, setFreezeTarget] = useState<StockItem | null>(null);
  const list = usePagedList<StockItem>('/api/inv/stock', 10, {
    warehouse_id: warehouseId,
    color_code: colorCode,
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-stone-900">库存余额</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            分仓台账：现有量由采购到货 / 销售发货 / 调拨 / 盘点自动维护，可用量 = 现有 − 冻结
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/inventory/alerts">库存预警</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/inventory/movements">库存流水</Link>
          </Button>
        </div>
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
        <WarehouseFilterSelect
          value={warehouseId}
          onChange={(v) => {
            list.setPage(1);
            setWarehouseId(v);
          }}
        />
        <Input
          value={colorInput}
          onChange={(e) => setColorInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              list.setPage(1);
              setColorCode(colorInput.trim());
            }
          }}
          placeholder="色号编码过滤，回车确认"
          className="h-9 w-full sm:w-40"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            list.setKeyword(searchInput);
            list.setPage(1);
            setColorCode(colorInput.trim());
          }}
          aria-label="搜索"
        >
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
            {list.keyword || warehouseId ? '没有符合条件的库存记录' : '暂无库存记录，完成采购到货后自动生成'}
          </p>
        </div>
      ) : (
        <>
          {/* 移动端：卡片清单 */}
          <div className="grid gap-2.5 lg:hidden">
            {list.items.map((row) => {
              const available = Number(row.available);
              const out = available <= 0;
              return (
                <div
                  key={`${row.warehouse_id}-${row.product_id}-${row.color_code ?? ''}`}
                  className="rounded-lg border border-stone-200 bg-white p-3.5 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-stone-900">{row.product_name}</div>
                      <div className="mt-0.5 font-mono text-xs text-stone-500">
                        {row.sku_code ?? '—'}
                        {row.color_name ? ` · ${row.color_name}(${row.color_code})` : ' · 默认色'} ·{' '}
                        {row.warehouse_name ?? '默认仓'}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 text-base font-bold tabular-nums ${
                        out ? 'text-red-600' : 'text-stone-900'
                      }`}
                    >
                      {formatQty(available)}
                      <span className="ml-0.5 text-xs font-normal text-stone-500">{row.unit ?? ''}</span>
                    </span>
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-stone-500">现有</dt>
                      <dd className="mt-0.5 tabular-nums text-stone-800">{formatQty(Number(row.quantity))}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-500">冻结</dt>
                      <dd className="mt-0.5 tabular-nums text-stone-800">{formatQty(Number(row.frozen_quantity))}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-500">在途</dt>
                      <dd className="mt-0.5 tabular-nums text-stone-800">{formatQty(Number(row.in_transit))}</dd>
                    </div>
                  </dl>
                  {canWrite ? (
                    <div className="mt-2.5 flex justify-end border-t border-stone-100 pt-2">
                      <Button variant="outline" size="sm" onClick={() => setFreezeTarget(row)}>
                        <Lock className="mr-1 h-3.5 w-3.5" />
                        冻结/解冻
                      </Button>
                    </div>
                  ) : null}
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
                  <TableHead>色号</TableHead>
                  <TableHead>仓库</TableHead>
                  <TableHead className="text-right">现有量</TableHead>
                  <TableHead className="text-right">冻结量</TableHead>
                  <TableHead className="text-right">可用量</TableHead>
                  <TableHead className="text-right">在途量</TableHead>
                  <TableHead className="text-right">移动均价</TableHead>
                  <TableHead className="text-right">库存货值</TableHead>
                  <TableHead>最近变动</TableHead>
                  {canWrite ? <TableHead className="text-right">操作</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.items.map((row) => {
                  const available = Number(row.available);
                  const out = available <= 0;
                  return (
                    <TableRow key={`${row.warehouse_id}-${row.product_id}-${row.color_code ?? ''}`}>
                      <TableCell className="font-mono text-xs text-stone-500">{row.sku_code ?? '—'}</TableCell>
                      <TableCell className="font-medium text-stone-800">{row.product_name}</TableCell>
                      <TableCell className="text-xs text-stone-600">
                        {row.color_name ? (
                          <span>
                            {row.color_name}
                            <span className="ml-1 font-mono text-stone-400">{row.color_code}</span>
                          </span>
                        ) : (
                          <span className="text-stone-400">默认色</span>
                        )}
                      </TableCell>
                      <TableCell className="text-stone-600">{row.warehouse_name ?? '默认仓'}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-stone-900">
                        {formatQty(Number(row.quantity))}
                        <span className="ml-0.5 text-xs font-normal text-stone-400">{row.unit ?? ''}</span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-stone-600">
                        {formatQty(Number(row.frozen_quantity))}
                      </TableCell>
                      <TableCell
                        className={`text-right font-bold tabular-nums ${out ? 'text-red-600' : 'text-stone-900'}`}
                      >
                        {formatQty(available)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-stone-600">
                        {formatQty(Number(row.in_transit))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-stone-600">
                        ¥{Number(row.avg_cost ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-stone-600">
                        ¥{Number(row.total_cost ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums text-stone-500">
                        {row.updated_at ? row.updated_at.slice(0, 16).replace('T', ' ') : '—'}
                      </TableCell>
                      {canWrite ? (
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => setFreezeTarget(row)}>
                            <Lock className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      ) : null}
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

      <FreezeDialog
        row={freezeTarget}
        open={freezeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFreezeTarget(null);
        }}
        onDone={() => list.reload()}
      />
    </div>
  );
}
