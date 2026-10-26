'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { PagedList, SalesOrder, SoShipment } from '@/lib/types';
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
import { Textarea } from '@/components/ui/textarea';

function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface ReturnRow {
  productId: string;
  productName: string;
  unit: string;
  orderQuantity: number;
  unitPrice: number;
  quantity: string;
}

/** 新建销售退货单：选择已审/已出库订单带出明细，单价锁定订单成交价，红字回补库存与成本 */
function NewReturnForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetOrderId = searchParams.get('order');

  const [orders, setOrders] = useState<SalesOrder[] | null>(null);
  const [orderId, setOrderId] = useState(presetOrderId ?? '');
  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [shipments, setShipments] = useState<SoShipment[]>([]);
  const [shipmentId, setShipmentId] = useState('');
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [returnDate, setReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  // 候选订单：已审批 / 已出库
  useEffect(() => {
    Promise.all([
      apiFetch<PagedList<SalesOrder>>('/api/so/orders?status=approved&page=1&pageSize=100'),
      apiFetch<PagedList<SalesOrder>>('/api/so/orders?status=shipped&page=1&pageSize=100'),
    ])
      .then(([a, b]) => setOrders([...a.items, ...b.items]))
      .catch(() => {
        toast.error('销售订单列表加载失败');
        setOrders([]);
      });
  }, []);

  // 选定订单后加载明细与可关联出库单
  useEffect(() => {
    if (!orderId) return;
    setOrder(null);
    setRows([]);
    setShipmentId('');
    apiFetch<SalesOrder>(`/api/so/orders/${orderId}`)
      .then((data) => {
        if (data.status !== 'approved' && data.status !== 'shipped') {
          toast.error('仅已审批或已出库的订单可创建退货单');
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
            quantity: '0',
          })),
        );
      })
      .catch(() => toast.error('订单加载失败'));
    apiFetch<PagedList<SoShipment>>('/api/so/shipments?status=approved&page=1&pageSize=100')
      .then((data) => setShipments(data.items.filter((s) => s.order_id === orderId)))
      .catch(() => setShipments([]));
  }, [orderId]);

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
    if (!orderId) {
      toast.error('请选择销售订单');
      return;
    }
    if (!reason.trim()) {
      toast.error('请填写退货原因');
      return;
    }
    const items = rows
      .filter((row) => Number(row.quantity) > 0)
      .map((row) => ({ product_id: row.productId, quantity: Number(row.quantity) }));
    if (items.length === 0) {
      toast.error('请至少填写一行有效的退货数量');
      return;
    }
    if (rows.some((row) => Number(row.quantity) > row.orderQuantity)) {
      toast.error('退货数量不能超过订单数量');
      return;
    }
    setSaving(true);
    try {
      const created = await apiFetch<{ id: string }>('/api/so/returns', {
        method: 'POST',
        body: JSON.stringify({
          order_id: orderId,
          shipment_id: shipmentId || undefined,
          return_date: returnDate,
          reason: reason.trim(),
          remark: remark.trim() || undefined,
          items,
        }),
      });
      toast.success('退货单已创建，请提交审核');
      router.replace(`/sales/returns/${created.id}`);
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
          <h1 className="text-lg font-bold text-stone-900">新建销售退货单</h1>
          <p className="text-xs text-stone-500 sm:text-sm">审核通过后红字回补库存与成本，并冲减客户应收</p>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>
              销售订单 <span className="text-red-600">*</span>
            </Label>
            {orders === null ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={orderId} onValueChange={setOrderId} disabled={Boolean(presetOrderId)}>
                <SelectTrigger>
                  <SelectValue placeholder="选择已审批 / 已出库订单" />
                </SelectTrigger>
                <SelectContent>
                  {orders.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.order_no} · {o.customer_name ?? '—'}（{o.status === 'shipped' ? '已出库' : '已审批'}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>关联出库单（选填）</Label>
            <Select value={shipmentId || 'none'} onValueChange={(v) => setShipmentId(v === 'none' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder="不关联" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">不关联</SelectItem>
                {shipments.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.shipment_no} · {s.ship_date}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="return_date">退货日期</Label>
            <Input id="return_date" type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="remark">备注</Label>
            <Input id="remark" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="选填" maxLength={500} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reason">
            退货原因 <span className="text-red-600">*</span>
          </Label>
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="如：破损、色差、规格不符…"
            maxLength={200}
            rows={2}
          />
        </div>

        {order ? (
          <div>
            <Label className="mb-2 block">退货明细（单价为订单锁定成交价）</Label>
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
                      <Label className="text-xs text-stone-500">本次退货数量</Label>
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
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 pt-4">
          <p className="text-sm text-stone-600">
            退货金额：<span className="font-semibold tabular-nums text-stone-900">{formatMoney(total)}</span>
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.back()} disabled={saving}>
              取消
            </Button>
            <Button onClick={onSubmit} disabled={saving || !order}>
              {saving ? '创建中…' : '创建退货单'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function NewSalesReturnPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-4xl space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      <NewReturnForm />
    </Suspense>
  );
}
