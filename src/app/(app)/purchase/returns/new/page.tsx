'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { PagedList, Supplier } from '@/lib/types';
import { buildDocItems, DocItemEditor, type DocItemRow } from '@/components/purchase/doc-item-editor';
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

/** 新建采购退货单：选择供应商 + 明细 + 退货原因 */
export default function NewReturnPage() {
  const router = useRouter();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState<DocItemRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<PagedList<Supplier>>('/api/md/suppliers?page=1&pageSize=100')
      .then((data) => setSuppliers(data.items))
      .catch(() => toast.error('供应商列表加载失败'));
  }, []);

  async function onSubmit() {
    if (!supplierId) {
      toast.error('请选择供应商');
      return;
    }
    if (!reason.trim()) {
      toast.error('请填写退货原因');
      return;
    }
    const built = buildDocItems(items);
    if (!built) {
      toast.error('请完善明细行：选择商品并填写有效数量与单价');
      return;
    }
    setSaving(true);
    try {
      const created = await apiFetch<{ id: string }>('/api/po/returns', {
        method: 'POST',
        body: JSON.stringify({
          supplier_id: supplierId,
          return_date: returnDate,
          reason: reason.trim(),
          remark: remark.trim() || undefined,
          items: built,
        }),
      });
      toast.success('退货单已创建，请提交审核');
      router.replace(`/purchase/returns/${created.id}`);
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
          <h1 className="text-lg font-bold text-stone-900">新建采购退货单</h1>
          <p className="text-xs text-stone-500 sm:text-sm">审核通过后按当前库存均价出库并冲减应付</p>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>
              供应商 <span className="text-red-600">*</span>
            </Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger>
                <SelectValue placeholder="选择供应商" />
              </SelectTrigger>
              <SelectContent>
                {suppliers.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.code} · {supplier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="return_date">退货日期</Label>
            <Input id="return_date" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="reason">
              退货原因 <span className="text-red-600">*</span>
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="如：破损、色差、规格不符"
              maxLength={500}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="remark">备注</Label>
            <Input id="remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="选填" maxLength={500} />
          </div>
        </div>

        <div>
          <Label className="mb-2 block">退货明细</Label>
          <DocItemEditor items={items} onChange={setItems} />
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
