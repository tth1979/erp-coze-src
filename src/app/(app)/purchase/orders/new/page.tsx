'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { OrderEditor } from '@/components/purchase/order-editor';
import { Button } from '@/components/ui/button';

export default function NewPurchaseOrderPage() {
  const router = useRouter();

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.back()} aria-label="返回">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-lg font-bold text-stone-900">新建采购订单</h1>
          <p className="text-xs text-stone-500 sm:text-sm">创建后保存为草稿，确认后不可再修改</p>
        </div>
      </div>

      <OrderEditor
        mode="create"
        onSaved={(order) => router.replace(`/purchase/orders/${order.id}`)}
        onCancel={() => router.back()}
      />
    </div>
  );
}
