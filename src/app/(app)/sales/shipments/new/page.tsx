'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { SalesOrder } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';

function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface ShipRow {
  productId: string;
  productName: string;
  unit: string;
  orderQuantity: number;
  unitPrice: number;
  quantity: string;
}

/** 新建出库单：从已审批销售订单带入明细；单价锁定为订单成交价，数量不得超订单剩余量（服务端强校验） */
function NewShipmentForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get('order');

  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [rows, setRows] = useState<ShipRow[]>([]);
  const [shipDate, setShipDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!orderId) return;
    apiFetch<SalesOrder>(`/api/so/orders/${orderId}`)
      .then((data) => {
        if (data.status !== 'approved') {
          toast.error('仅已审批的销售订单可创建出库单');
          router.replace('/sales/orders');
          return;
        }
        setOrder(data);
        setRows(
          (data.items ?? []).map((item) => ({
            productId: item.product_id,
            productName: item.product_name ?? '',
            unit: item.unit ?? '',
            orderQuantity: item.quantity,
            unitPrice: item.unit_price,
            quantity: String(item.quantity),
          })),
        );
      })
      .catch(() => {
        toast.error('订单加载失败');
        router.replace('/sales/orders');
      });
  }, [orderId, router]);

  const total = useMemo(
    () =>
      rows.reduce((sum, row) => {
        const qty = Number(row.quantity);
        return sum + (Number.isFinite(qty) && row.quantity !== '' ? qty * row.unitPrice : 0);
      }, 0),
    [rows],
  );

  function updateQuantity(productId: string, quantity: string) {
    setRows((prev) => prev.map((row) => (row.productId === productId ? { ...row, quantity } : row)));
  }

  async function onSubmit() {
    if (!orderId) return;
    const items = rows
      .filter((row) => Number(row.quantity) > 0)
      .map((row) => ({
        product_id: row.productId,
        quantity: Number(row.quantity),
        unit_price: row.unitPrice,
      }));
    if (items.length === 0) {
      toast.error('请至少填写一行有效的出库数量');
      return;
    }
    if (rows.some((row) => Number(row.quantity) > row.orderQuantity)) {
      toast.error('出库数量不能超过订单数量');
      return;
    }
    setSaving(true);
    try {
      const created = await apiFetch<{ id: string }>('/api/so/shipments', {
        method: 'POST',
        body: JSON.stringify({
          order_id: orderId,
          ship_date: shipDate,
          remark: remark.trim() || undefined,
          items,
        }),
      });
      toast.success('出库单已创建，请提交审核');
      router.replace(`/sales/shipments/${created.id}`);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '创建失败');
      setSaving(false);
    }
  }

  if (!orderId) {
    return (
      <div className="mx-auto max-w-4xl rounded-lg border border-stone-200 bg-white p-8 text-center">
        <p className="text-sm text-stone-500">请从「已审批」的销售订单详情页点击「创建出库单」进入</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => router.push('/sales/orders')}>
          前往销售订单
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
          <h1 className="text-lg font-bold text-stone-900">新建销售出库单</h1>
          <p className="text-xs text-stone-500 sm:text-sm">
            来源订单 <span className="font-mono">{order.order_no}</span> · {order.customer_name}
            {order.customer_level === 'vip' ? '（VIP 客户）' : order.customer_level === 'strategic' ? '（战略客户）' : ''}
          </p>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ship_date">出库日期</Label>
            <Input id="ship_date" type="date" value={shipDate} onChange={(e) => setShipDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="remark">备注</Label>
            <Input id="remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="选填" maxLength={500} />
          </div>
        </div>

        <div>
          <Label className="mb-2 block">出库明细（单价为订单锁定成交价）</Label>
          <div className="space-y-2.5">
            {rows.map((row, index) => {
              const qty = Number(row.quantity);
              const over = Number.isFinite(qty) && qty > row.orderQuantity;
              return (
                <div
                  key={row.productId}
                  className="grid grid-cols-2 items-end gap-2 rounded-md border border-stone-200 p-3 md:grid-cols-[1fr_90px_110px_110px] md:border-0 md:p-0"
                >
                  <div className="col-span-2 space-y-1 md:col-span-1">
                    <Label className="text-xs text-stone-500">商品 {index + 1}</Label>
                    <p className="text-sm text-stone-800">{row.productName}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-stone-500">订单数量{row.unit ? `（${row.unit}）` : ''}</Label>
                    <p className="text-sm tabular-nums text-stone-600">{row.orderQuantity}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-stone-500">本次出库数量</Label>
                    <Input
                      type="number"
                      min={0}
                      max={row.orderQuantity}
                      step="any"
                      value={row.quantity}
                      onChange={(e) => updateQuantity(row.productId, e.target.value)}
                      className={over ? 'border-red-500' : ''}
                    />
                    {over ? <p className="text-xs text-red-600">超出订单数量</p> : null}
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-stone-500">锁定单价</Label>
                    <p className="text-sm tabular-nums text-stone-800">{formatMoney(row.unitPrice)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
          <p className="text-sm text-stone-600">
            合计金额：<span className="font-semibold tabular-nums text-stone-900">{formatMoney(total)}</span>
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.back()} disabled={saving}>
              取消
            </Button>
            <Button onClick={onSubmit} disabled={saving}>
              {saving ? '创建中…' : '创建出库单'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewShipmentPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <NewShipmentForm />
    </Suspense>
  );
}
