'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { WarehouseSelect } from '@/components/inventory/warehouse-select';
import { apiFetch, ApiClientError } from '@/lib/api-client';
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
import { Textarea } from '@/components/ui/textarea';

interface TransferItemRow {
  key: string;
  productId: string;
  colorCode: string;
  quantity: string;
}

/** 色号选项（/api/md/colors 返回项） */
interface ColorOption {
  product_id: string;
  color_code: string;
  color_name: string;
  status: string;
}

let rowKey = 0;
function newRow(): TransferItemRow {
  rowKey += 1;
  return { key: `row-${rowKey}`, productId: '', colorCode: '', quantity: '' };
}

/** 新建库存调拨单：调出仓 ≠ 调入仓，明细只需商品+数量（成本按调出时移动均价快照） */
export default function NewTransferPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState<TransferItemRow[]>([newRow()]);
  const [colorsMap, setColorsMap] = useState<Map<string, ColorOption[]>>(new Map());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<{ items: Product[] }>('/api/md/products?page=1&pageSize=100')
      .then((res) => setProducts(res.items))
      .catch(() => toast.error('商品列表加载失败'));
    apiFetch<{ items: ColorOption[] }>('/api/md/colors')
      .then((res) => {
        const map = new Map<string, ColorOption[]>();
        for (const color of res.items) {
          if (color.status !== 'active') continue;
          const arr = map.get(color.product_id) ?? [];
          arr.push(color);
          map.set(color.product_id, arr);
        }
        setColorsMap(map);
      })
      .catch(() => {
        /* 色号档案加载失败不阻塞建单，默认色号 */
      });
  }, []);

  function updateItem(key: string, patch: Partial<TransferItemRow>) {
    setItems(items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  async function onSubmit() {
    if (!fromWarehouseId) {
      toast.error('请选择调出仓');
      return;
    }
    if (!toWarehouseId) {
      toast.error('请选择调入仓');
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      toast.error('调出仓与调入仓不能相同');
      return;
    }
    const built: Array<{ product_id: string; color_code?: string; quantity: number }> = [];
    for (const item of items) {
      const qty = Number(item.quantity);
      if (!item.productId || !Number.isFinite(qty) || qty <= 0) {
        toast.error('请完善明细行：选择商品并填写有效数量');
        return;
      }
      built.push({
        product_id: item.productId,
        color_code: item.colorCode || undefined,
        quantity: qty,
      });
    }
    if (built.length === 0) {
      toast.error('请至少填写一行明细');
      return;
    }
    setSaving(true);
    try {
      const created = await apiFetch<{ id: string }>('/api/inv/transfers', {
        method: 'POST',
        body: JSON.stringify({
          from_warehouse_id: fromWarehouseId,
          to_warehouse_id: toWarehouseId,
          remark: remark.trim() || undefined,
          items: built,
        }),
      });
      toast.success('调拨单已创建，请提交审核');
      router.replace(`/inventory/transfers/${created.id}`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '创建失败');
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.back()} aria-label="返回">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-bold text-stone-900">新建库存调拨单</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            审核通过后调出仓立即扣减（转入调入仓在途），收货后计入调入仓现有库存
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>
              调出仓 <span className="text-red-600">*</span>
            </Label>
            <WarehouseSelect value={fromWarehouseId} onChange={setFromWarehouseId} placeholder="选择调出仓" />
          </div>
          <div className="space-y-1.5">
            <Label>
              调入仓 <span className="text-red-600">*</span>
            </Label>
            <WarehouseSelect value={toWarehouseId} onChange={setToWarehouseId} placeholder="选择调入仓" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="remark">备注</Label>
          <Textarea
            id="remark"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="选填，如：门店补货 / 仓位整理"
            maxLength={500}
            rows={2}
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label>调拨明细</Label>
            <Button variant="outline" size="sm" onClick={() => setItems([...items, newRow()])}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              添加明细
            </Button>
          </div>
          <div className="space-y-2.5">
            {items.map((item, index) => (
              <div
                key={item.key}
                className="grid grid-cols-[1fr_150px_110px_36px] items-end gap-2 rounded-md border border-stone-200 p-3 md:border-0 md:p-0"
              >
                <div className="space-y-1">
                  <Label className="text-xs text-stone-500">商品 {index + 1}</Label>
                  <Select
                    value={item.productId || undefined}
                    onValueChange={(value) => updateItem(item.key, { productId: value, colorCode: '' })}
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
                    onValueChange={(value) =>
                      updateItem(item.key, { colorCode: value === '__default__' ? '' : value })
                    }
                    disabled={!item.productId}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="默认色" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">默认色</SelectItem>
                      {(colorsMap.get(item.productId) ?? []).map((color) => (
                        <SelectItem key={color.color_code} value={color.color_code}>
                          {color.color_name}（{color.color_code}）
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
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-9 w-9 text-stone-400 hover:text-red-600"
                  onClick={() => setItems(items.filter((it) => it.key !== item.key))}
                  disabled={items.length <= 1}
                  aria-label="删除明细行"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-stone-100 pt-4">
          <Button variant="outline" onClick={() => router.back()}>
            取消
          </Button>
          <Button disabled={saving} onClick={() => void onSubmit()}>
            {saving ? '保存中…' : '保存为草稿'}
          </Button>
        </div>
      </div>
    </div>
  );
}
