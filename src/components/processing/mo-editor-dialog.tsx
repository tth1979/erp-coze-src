'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { MaEditableItem, Product } from '@/lib/types';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface Row {
  kind: 'input' | 'output';
  product_id: string;
  quantity: string;
}

/** 新任务行初始 */
function blank(kind: 'input' | 'output'): Row {
  return { kind, product_id: '', quantity: '1' };
}

export function MoEditorDialog({
  open,
  onOpenChange,
  processingTypes,
  onSaved,
  id,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  processingTypes: { code: string; label: string }[];
  onSaved: () => void;
  id?: string;
  initial?: { processing_type: string; loss_ratio: number; items: MaEditableItem[] };
}) {
  const [type, setType] = useState('');
  const [loss, setLoss] = useState('5');
  const [remark, setRemark] = useState('');
  const [rows, setRows] = useState<Row[]>(() => [blank('input'), blank('output')]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setType(initial.processing_type);
      setLoss(String(Math.round(initial.loss_ratio * 100)));
      setRows(
        initial.items.map((i) => ({
          kind: i.kind,
          product_id: i.product_id,
          quantity: String(i.quantity),
        })),
      );
      setRemark('');
    } else {
      setType(processingTypes[0]?.code ?? '');
      setLoss('5');
      setRows([blank('input'), blank('output')]);
      setRemark('');
    }
    apiFetch<{ items: Product[] }>('/api/md/products?pageSize=100')
      .then((d) => setProducts(d.items))
      .catch(() => setProducts([]));
  }, [open, initial, processingTypes]);

  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  function setRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function handleSave() {
    if (!type) {
      toast.error('请选择加工类型');
      return;
    }
    const items: MaEditableItem[] = rows
      .filter((r) => r.product_id && Number(r.quantity) > 0)
      .map((r) => ({ kind: r.kind, product_id: r.product_id, quantity: Number(r.quantity) }));
    if (items.length === 0) {
      toast.error('请至少填写一条投入与产出行');
      return;
    }
    const hasInput = items.some((i) => i.kind === 'input');
    const hasOutput = items.some((i) => i.kind === 'output');
    if (!hasInput || !hasOutput) {
      toast.error('需同时包含投入原料与产出成品');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        processing_type: type,
        loss_ratio: Math.round((Number(loss) || 0) * 100) / 100 / 100,
        items,
        remark: remark || undefined,
      };
      if (initial) {
        if (!id) throw new Error('missing id');
        await apiFetch('/api/ma/orders/' + id, { method: 'PUT', body: JSON.stringify(payload) });
        toast.success('加工单已更新');
      } else {
        await apiFetch('/api/ma/orders', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('加工单已创建');
      }
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '保存失败');
    } finally {
      setLoading(false);
    }
  }

  const initial_id = ''; // 由调用方解析

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? '编辑加工单' : '新建加工单'}</DialogTitle>
          <DialogDescription>
            配置加工类型、损耗比例与投入/产出明细；审批通过后可分批领料与完工。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>加工类型</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger>
                  <SelectValue placeholder="选择加工类型" />
                </SelectTrigger>
                <SelectContent>
                  {processingTypes.map((t) => (
                    <SelectItem key={t.code} value={t.code}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>损耗比例（%）</Label>
              <Input
                type="number"
                min={0}
                max={59}
                value={loss}
                onChange={(e) => setLoss(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>投入 / 产出明细（投入=原料，产出=成品）</Label>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[90px_1fr_90px_36px] items-center gap-2">
                <Select value={r.kind} onValueChange={(v) => setRow(i, { kind: v as 'input' | 'output' })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="input">投入</SelectItem>
                    <SelectItem value="output">产出</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={r.product_id}
                  onValueChange={(v) => setRow(i, { product_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择商品" />
                  </SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}（{p.sku_code}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min={1}
                  value={r.quantity}
                  onChange={(e) => setRow(i, { quantity: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setRows((rs) => rs.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRows((rs) => [...rs, blank('input')])}
              >
                <Plus className="mr-1 h-4 w-4" /> 投入行
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRows((rs) => [...rs, blank('output')])}
              >
                <Plus className="mr-1 h-4 w-4" /> 产出行
              </Button>
            </div>
          </div>
          <div>
            <Label>备注</Label>
            <Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="（可选）" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}