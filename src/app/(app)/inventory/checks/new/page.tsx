'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { WarehouseSelect } from '@/components/inventory/warehouse-select';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/** 新建库存盘点单：选择仓库后自动快照该仓账面库存为盘点明细 */
export default function NewCheckPage() {
  const router = useRouter();
  const [warehouseId, setWarehouseId] = useState('');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  async function onSubmit() {
    if (!warehouseId) {
      toast.error('请选择盘点仓库');
      return;
    }
    setSaving(true);
    try {
      const created = await apiFetch<{ id: string }>('/api/inv/checks', {
        method: 'POST',
        body: JSON.stringify({
          warehouse_id: warehouseId,
          remark: remark.trim() || undefined,
        }),
      });
      toast.success('盘点单已创建，请录入实盘数后提交审批');
      router.replace(`/inventory/checks/${created.id}`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '创建失败');
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.back()} aria-label="返回">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-bold text-stone-900">新建库存盘点单</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            建单时将自动快照该仓库全部账面库存作为盘点范围，下一步在详情页录入实盘数量
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <div className="space-y-1.5">
          <Label>
            盘点仓库 <span className="text-red-600">*</span>
          </Label>
          <WarehouseSelect value={warehouseId} onChange={setWarehouseId} placeholder="选择要盘点的仓库" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="remark">备注</Label>
          <Textarea
            id="remark"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            placeholder="选填，如：月末例行盘点"
            maxLength={500}
            rows={2}
          />
        </div>
        <div className="flex justify-end gap-2 border-t border-stone-100 pt-4">
          <Button variant="outline" onClick={() => router.back()}>
            取消
          </Button>
          <Button disabled={saving} onClick={() => void onSubmit()}>
            {saving ? '创建中…' : '创建并录入实盘'}
          </Button>
        </div>
      </div>
    </div>
  );
}
