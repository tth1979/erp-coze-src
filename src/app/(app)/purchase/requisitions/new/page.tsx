'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { buildDocItems, DocItemEditor, newDocItem, type DocItemRow } from '@/components/purchase/doc-item-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function NewRequisitionPage() {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState<DocItemRow[]>([newDocItem()]);
  const [saving, setSaving] = useState(false);

  async function onSubmit() {
    const built = buildDocItems(items);
    if (!built) {
      toast.error('请完善明细行：选择商品并填写有效数量与建议价');
      return;
    }
    setSaving(true);
    try {
      const created = await apiFetch<{ id: string }>('/api/po/requisitions', {
        method: 'POST',
        body: JSON.stringify({
          reason: reason.trim() || undefined,
          remark: remark.trim() || undefined,
          items: built.map((item) => ({ ...item, suggest_price: item.unit_price })),
        }),
      });
      toast.success('申请单已创建，请提交审批');
      router.replace(`/purchase/requisitions/${created.id}`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '创建失败');
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push('/purchase/requisitions')} aria-label="返回列表">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-bold text-stone-900">新建采购申请单</h1>
          <p className="text-xs text-stone-500 sm:text-sm">创建后进入草稿，提交审批通过后方可转采购订单</p>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="reason">采购事由</Label>
            <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="如：800×800 常规补货" maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="remark">备注</Label>
            <Input id="remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="选填" maxLength={500} />
          </div>
        </div>

        <div>
          <Label className="mb-2 block">申请明细（建议价为预估采购单价）</Label>
          <DocItemEditor items={items} onChange={setItems} priceLabel="建议价" />
        </div>

        <div className="flex justify-end gap-2 border-t border-stone-100 pt-4">
          <Button variant="outline" onClick={() => router.push('/purchase/requisitions')}>
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
