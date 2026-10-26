'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { PurchaseOrder } from '@/lib/types';
import { buildDocItems, DocItemEditor, newDocItem, type DocItemRow } from '@/components/purchase/doc-item-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';

/** 新建入库单：从已审批采购订单带入明细，支持暂估入库（发票未到） */
function NewReceiptForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get('order');

  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [items, setItems] = useState<DocItemRow[]>([]);
  const [receiveDate, setReceiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [isEstimated, setIsEstimated] = useState(false);
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    apiFetch<PurchaseOrder>(`/api/po/orders/${orderId}`)
      .then((data) => {
        if (data.status !== 'approved') {
          toast.error('仅已审批的采购订单可创建入库单');
          router.replace('/purchase/orders');
          return;
        }
        setOrder(data);
        setItems(
          (data.items ?? []).map((item) =>
            newDocItem(item.product_id, String(item.quantity), String(item.unit_price)),
          ),
        );
      })
      .catch(() => {
        toast.error('订单加载失败');
        router.replace('/purchase/orders');
      });
  }, [orderId, router]);

  async function onSubmit() {
    if (!orderId) return;
    const built = buildDocItems(items);
    if (!built) {
      toast.error('请完善明细行：选择商品并填写有效数量与单价');
      return;
    }
    setSaving(true);
    try {
      const created = await apiFetch<{ id: string }>('/api/po/receipts', {
        method: 'POST',
        body: JSON.stringify({
          order_id: orderId,
          receive_date: receiveDate,
          is_estimated: isEstimated,
          remark: remark.trim() || undefined,
          items: built,
        }),
      });
      toast.success('入库单已创建，请提交审核');
      router.replace(`/purchase/receipts/${created.id}`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '创建失败');
      setSaving(false);
    }
  }

  if (!orderId) {
    return (
      <div className="mx-auto max-w-4xl rounded-lg border border-stone-200 bg-white p-8 text-center">
        <p className="text-sm text-stone-500">请从「已审批」的采购订单详情页点击「创建入库单」进入</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => router.push('/purchase/orders')}>
          前往采购订单
        </Button>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-4xl space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.back()} aria-label="返回">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-bold text-stone-900">新建采购入库单</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            来源订单 <span className="font-mono">{order.order_no}</span> · {order.supplier_name}
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="receive_date">入库日期</Label>
            <Input id="receive_date" type="date" value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="remark">备注</Label>
            <Input id="remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="选填" maxLength={500} />
          </div>
          <div className="flex items-end gap-2 pb-1">
            <Checkbox
              id="is_estimated"
              checked={isEstimated}
              onCheckedChange={(checked) => setIsEstimated(checked === true)}
            />
            <Label htmlFor="is_estimated" className="cursor-pointer text-sm font-normal">
              暂估入库（发票未到）
            </Label>
          </div>
        </div>
        {isEstimated ? (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
            暂估入库按当前单价暂估成本；来票后请在入库单详情执行「暂估冲回」，系统将红字冲销并按发票价蓝字重入。
          </p>
        ) : null}

        <div>
          <Label className="mb-2 block">入库明细</Label>
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

export default function NewReceiptPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <NewReceiptForm />
    </Suspense>
  );
}
