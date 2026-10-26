'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { Product } from '@/lib/types';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface ProductFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: Product | null;
  onSaved: () => void;
}

const EMPTY = {
  sku_code: '',
  name: '',
  model: '',
  spec: '',
  unit: '片',
  barcode: '',
  category: '',
  brand: '',
  color: '',
  pieces_per_box: '',
  area_per_box: '',
  reference_purchase_price: '',
  reference_sale_price: '',
  status: 'active',
  remark: '',
};

const CATEGORIES = ['抛光砖', '釉面砖', '仿古砖', '岩板', '大理石瓷砖', '木纹砖', '马赛克', '其他'];
const UNITS = ['片', '箱', '㎡'];

/** 数字输入：空串 → null，非法 → 保持 undefined 交给服务端校验兜底 */
function toNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function ProductFormDialog({ open, onOpenChange, initial, onSaved }: ProductFormDialogProps) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        sku_code: initial.sku_code,
        name: initial.name,
        model: initial.model ?? '',
        spec: initial.spec ?? '',
        unit: initial.unit,
        barcode: initial.barcode ?? '',
        category: initial.category ?? '',
        brand: initial.brand ?? '',
        color: initial.color ?? '',
        pieces_per_box: initial.pieces_per_box === null ? '' : String(initial.pieces_per_box),
        area_per_box: initial.area_per_box ?? '',
        reference_purchase_price: initial.reference_purchase_price ?? '',
        reference_sale_price: initial.reference_sale_price ?? '',
        status: initial.status,
        remark: initial.remark ?? '',
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, initial]);

  function set(field: keyof typeof EMPTY) {
    return (value: string) => setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        pieces_per_box: toNumber(form.pieces_per_box),
        area_per_box: toNumber(form.area_per_box),
        reference_purchase_price: toNumber(form.reference_purchase_price),
        reference_sale_price: toNumber(form.reference_sale_price),
      };
      const body = JSON.stringify(payload);
      if (initial) {
        await apiFetch(`/api/md/products/${initial.id}`, { method: 'PUT', body });
        toast.success('商品已更新');
      } else {
        await apiFetch('/api/md/products', { method: 'POST', body });
        toast.success('商品已创建');
      }
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{initial ? '编辑商品' : '新增商品'}</DialogTitle>
          <DialogDescription>商品编码（SKU）在系统内唯一；型号 / 规格 / 单位 / 条形码为瓷砖主数据核心字段。</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="p-sku">商品编码 *</Label>
              <Input id="p-sku" value={form.sku_code} onChange={(e) => set('sku_code')(e.target.value)} required maxLength={32} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-name">商品名称 *</Label>
              <Input id="p-name" value={form.name} onChange={(e) => set('name')(e.target.value)} required maxLength={128} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-model">型号</Label>
              <Input id="p-model" placeholder="厂家型号" value={form.model} onChange={(e) => set('model')(e.target.value)} maxLength={64} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-spec">规格</Label>
              <Input id="p-spec" placeholder="如 800x800" value={form.spec} onChange={(e) => set('spec')(e.target.value)} maxLength={64} />
            </div>
            <div className="space-y-2">
              <Label>计量单位</Label>
              <Select value={form.unit} onValueChange={set('unit')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-barcode">条形码</Label>
              <Input id="p-barcode" value={form.barcode} onChange={(e) => set('barcode')(e.target.value)} maxLength={64} />
            </div>
            <div className="space-y-2">
              <Label>品类</Label>
              <Select value={form.category} onValueChange={set('category')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="选择品类" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-brand">品牌</Label>
              <Input id="p-brand" value={form.brand} onChange={(e) => set('brand')(e.target.value)} maxLength={64} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-color">颜色/色系</Label>
              <Input id="p-color" value={form.color} onChange={(e) => set('color')(e.target.value)} maxLength={64} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-pieces">每箱片数</Label>
              <Input id="p-pieces" type="number" min={0} value={form.pieces_per_box} onChange={(e) => set('pieces_per_box')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-area">每箱面积（㎡）</Label>
              <Input id="p-area" type="number" min={0} step="0.001" value={form.area_per_box} onChange={(e) => set('area_per_box')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>状态</Label>
              <Select value={form.status} onValueChange={set('status')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">启用</SelectItem>
                  <SelectItem value="disabled">停用</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-pp">参考进价（元）</Label>
              <Input id="p-pp" type="number" min={0} step="0.01" value={form.reference_purchase_price} onChange={(e) => set('reference_purchase_price')(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="p-sp">参考售价（元）</Label>
              <Input id="p-sp" type="number" min={0} step="0.01" value={form.reference_sale_price} onChange={(e) => set('reference_sale_price')(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="p-remark">备注</Label>
            <Textarea id="p-remark" value={form.remark} onChange={(e) => set('remark')(e.target.value)} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
