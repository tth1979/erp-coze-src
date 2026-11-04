'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { apiFetch } from '@/lib/api-client';
import type { Product } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

/** 采购申请/入库/退货单共用的明细行编辑器（商品 + 数量 + 单价） */

export interface DocItemRow {
  key: string;
  productId: string;
  colorCode: string;
  quantity: string;
  unitPrice: string;
}

let rowKey = 0;
export function newDocItem(productId = '', quantity = '', unitPrice = '', colorCode = ''): DocItemRow {
  rowKey += 1;
  return { key: `row-${rowKey}`, productId, colorCode, quantity, unitPrice };
}

/** 色号选项（/api/md/colors 返回项） */
export interface ColorOption {
  product_id: string;
  color_code: string;
  color_name: string;
  status: string;
}

/** 按商品分组的活跃色号映射 */
export function groupColorsByProduct(colors: ColorOption[]): Map<string, ColorOption[]> {
  const map = new Map<string, ColorOption[]>();
  for (const c of colors) {
    if (c.status !== 'active') continue;
    const arr = map.get(c.product_id) ?? [];
    arr.push(c);
    map.set(c.product_id, arr);
  }
  return map;
}

function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function DocItemEditor({
  items,
  onChange,
  priceLabel = '单价',
  readOnly = false,
}: {
  items: DocItemRow[];
  onChange: (items: DocItemRow[]) => void;
  priceLabel?: string;
  readOnly?: boolean;
}) {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [colorsMap, setColorsMap] = useState<Map<string, ColorOption[]>>(new Map());

  useEffect(() => {
    apiFetch<{ items: Product[] }>('/api/md/products?page=1&pageSize=100')
      .then((res) => setProducts(res.items))
      .catch(() => setProducts([]));
    apiFetch<{ items: ColorOption[] }>('/api/md/colors')
      .then((res) => setColorsMap(groupColorsByProduct(res.items)))
      .catch(() => setColorsMap(new Map()));
  }, []);

  function updateItem(key: string, patch: Partial<DocItemRow>) {
    onChange(items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function removeItem(key: string) {
    onChange(items.filter((item) => item.key !== key));
  }

  const total = items.reduce((sum, item) => {
    const qty = Number(item.quantity);
    const price = Number(item.unitPrice);
    return sum + (Number.isFinite(qty) && Number.isFinite(price) && item.quantity !== '' && item.unitPrice !== '' ? qty * price : 0);
  }, 0);

  if (products === null) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div>
      <div className="space-y-2.5">
        {items.map((item, index) => {
          const qty = Number(item.quantity);
          const price = Number(item.unitPrice);
          const amount =
            Number.isFinite(qty) && Number.isFinite(price) && item.quantity !== '' && item.unitPrice !== ''
              ? qty * price
              : null;
          const productColors = colorsMap.get(item.productId) ?? [];
          return (
            <div
              key={item.key}
              className="grid grid-cols-2 items-end gap-2 rounded-md border border-stone-200 p-3 md:grid-cols-[1fr_120px_100px_120px_100px_36px] md:border-0 md:p-0"
            >
              <div className="col-span-2 space-y-1 md:col-span-1">
                <Label className="text-xs text-stone-500">商品 {index + 1}</Label>
                <Select
                  value={item.productId || undefined}
                  onValueChange={(value) => {
                    const product = products.find((p) => p.id === value);
                    onChange(
                      items.map((it) =>
                        it.key === item.key
                          ? {
                              ...it,
                              productId: value,
                              colorCode: '', // 换商品后色号重置，避免串色
                              unitPrice: it.unitPrice || (product?.reference_purchase_price ?? ''),
                            }
                          : it,
                      ),
                    );
                  }}
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择商品" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((product) => (
                      <SelectItem key={product.id} value={product.id}>
                        {product.sku_code} · {product.name}
                        {product.spec ? ` · ${product.spec}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-stone-500">色号</Label>
                <Select
                  value={item.colorCode || '__default__'}
                  onValueChange={(value) => updateItem(item.key, { colorCode: value === '__default__' ? '' : value })}
                  disabled={readOnly || !item.productId}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="默认色" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__default__">默认（不分色）</SelectItem>
                    {productColors.map((c) => (
                      <SelectItem key={c.color_code} value={c.color_code}>
                        {c.color_code} · {c.color_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-stone-500">数量</Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={item.quantity}
                  onChange={(e) => updateItem(item.key, { quantity: e.target.value })}
                  placeholder="0"
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-stone-500">{priceLabel}</Label>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(item.key, { unitPrice: e.target.value })}
                  placeholder="0.00"
                  disabled={readOnly}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-stone-500">金额</Label>
                <div className="flex h-9 items-center text-sm font-medium tabular-nums text-stone-800">
                  {amount === null ? '—' : formatMoney(amount)}
                </div>
              </div>
              {!readOnly ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-stone-400 hover:text-destructive"
                  onClick={() => removeItem(item.key)}
                  disabled={items.length <= 1}
                  aria-label="删除明细行"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      {!readOnly ? (
        <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => onChange([...items, newDocItem()])}>
          <Plus className="mr-1 h-4 w-4" />
          添加一行
        </Button>
      ) : null}
      <div className="mt-4 flex items-center justify-between border-t border-stone-100 pt-3">
        <span className="text-xs text-stone-500 sm:text-sm">合计金额（提交后由服务端复核）</span>
        <span className="text-base font-bold tabular-nums text-stone-900 sm:text-lg">
          {formatMoney(Math.round(total * 100) / 100)}
        </span>
      </div>
    </div>
  );
}

/** 校验并组装提交明细（服务端字段；同一单据 型号+色号 不允许重复行） */
export function buildDocItems(items: DocItemRow[]): Array<{ product_id: string; quantity: number; unit_price: number; color_code: string }> | null {
  const built: Array<{ product_id: string; quantity: number; unit_price: number; color_code: string }> = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.productId) return null;
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    if (!Number.isFinite(quantity) || quantity <= 0) return null;
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return null;
    const unitKey = `${item.productId}|${item.colorCode}`;
    if (seen.has(unitKey)) return null; // 同型号同色号重复行
    seen.add(unitKey);
    built.push({ product_id: item.productId, quantity, unit_price: unitPrice, color_code: item.colorCode });
  }
  return built.length > 0 ? built : null;
}
