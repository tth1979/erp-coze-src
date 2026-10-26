'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Ban, CheckCircle2, Pencil, Trash2 } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { useAuth } from '@/components/auth/auth-provider';
import type { SalesOrder } from '@/lib/types';
import { OrderEditor } from '@/components/trade/order-editor';
import { TradeStatusBadge } from '@/components/trade/trade-status-badge';
import { ConfirmActionDialog } from '@/components/trade/confirm-action-dialog';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTime(value: string | null): string {
  if (!value) return '—';
  return value.slice(0, 16).replace('T', ' ');
}

export default function SalesOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const id = params.id;

  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<SalesOrder>(`/api/so/orders/${id}`)
      .then(setOrder)
      .catch((error: unknown) => {
        toast.error(error instanceof ApiClientError ? error.message : '订单加载失败');
        router.replace('/sales/orders');
      })
      .finally(() => setLoading(false));
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !order) {
    return (
      <div className="mx-auto max-w-4xl space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const writable = can('so.write');
  const isDraft = order.status === 'draft';

  // 编辑模式（仅草稿）
  if (editing && isDraft) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(false)} aria-label="返回详情">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-bold text-stone-900">编辑销售订单</h1>
            <p className="text-xs text-stone-500 sm:text-sm">
              单号 <span className="font-mono">{order.order_no}</span>
            </p>
          </div>
        </div>
        <OrderEditor
          kind="sales"
          mode="edit"
          initial={order}
          onSaved={() => {
            setEditing(false);
            load();
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  const items = order.items ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* 标题行 */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => router.push('/sales/orders')}
          aria-label="返回列表"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-lg font-bold text-stone-900">{order.order_no}</h1>
            <TradeStatusBadge status={order.status} />
          </div>
          <p className="text-xs text-stone-500 sm:text-sm">{order.customer_name ?? '客户已删除'}</p>
        </div>
        {writable && isDraft ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-1 h-4 w-4" />
              编辑
            </Button>
            <Button size="sm" onClick={() => setConfirmOpen(true)}>
              <CheckCircle2 className="mr-1 h-4 w-4" />
              确认订单
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>
              <Ban className="mr-1 h-4 w-4" />
              取消
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="mr-1 h-4 w-4" />
              删除
            </Button>
          </div>
        ) : null}
        {writable && order.status === 'confirmed' ? (
          <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>
            <Ban className="mr-1 h-4 w-4" />
            取消订单
          </Button>
        ) : null}
      </div>

      {/* 单据头 */}
      <div className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
          <div>
            <dt className="text-xs text-stone-500">客户</dt>
            <dd className="mt-0.5 text-stone-800">{order.customer_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">下单日期</dt>
            <dd className="mt-0.5 tabular-nums text-stone-800">{order.order_date}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">创建人</dt>
            <dd className="mt-0.5 text-stone-800">{order.created_by_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">确认时间</dt>
            <dd className="mt-0.5 tabular-nums text-stone-800">{formatTime(order.confirmed_at)}</dd>
          </div>
          {order.remark ? (
            <div className="col-span-2 md:col-span-4">
              <dt className="text-xs text-stone-500">备注</dt>
              <dd className="mt-0.5 text-stone-800">{order.remark}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {/* 明细：移动端卡片 / 桌面端表格 */}
      <div className="lg:hidden">
        <div className="space-y-2.5">
          {items.map((item, index) => (
            <div key={item.id} className="rounded-lg border border-stone-200 bg-white p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-stone-800">
                    {index + 1}. {item.product_name ?? '商品已删除'}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-stone-500">
                    {item.product_sku ?? ''}
                    {item.product_spec ? ` · ${item.product_spec}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-stone-900">
                  {formatMoney(item.amount)}
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-stone-500">数量</dt>
                  <dd className="mt-0.5 tabular-nums text-stone-800">
                    {item.quantity}
                    {item.unit ?? ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-stone-500">单价</dt>
                  <dd className="mt-0.5 tabular-nums text-stone-800">{formatMoney(item.unit_price)}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">金额</dt>
                  <dd className="mt-0.5 tabular-nums text-stone-800">{formatMoney(item.amount)}</dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex items-center justify-between rounded-lg border border-stone-200 bg-white p-3.5">
          <span className="text-sm text-stone-500">合计</span>
          <span className="text-base font-bold tabular-nums text-stone-900">{formatMoney(order.total_amount)}</span>
        </div>
      </div>

      <div className="hidden lg:block">
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">#</TableHead>
                <TableHead>商品</TableHead>
                <TableHead>规格</TableHead>
                <TableHead className="text-right">数量</TableHead>
                <TableHead className="text-right">单价</TableHead>
                <TableHead className="text-right">金额</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item, index) => (
                <TableRow key={item.id}>
                  <TableCell className="text-stone-500">{index + 1}</TableCell>
                  <TableCell>
                    <div className="text-sm text-stone-800">{item.product_name ?? '商品已删除'}</div>
                    <div className="font-mono text-xs text-stone-500">{item.product_sku ?? ''}</div>
                  </TableCell>
                  <TableCell className="text-stone-600">{item.product_spec ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.quantity}
                    {item.unit ?? ''}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(item.unit_price)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(item.amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-stone-50">
                <TableCell colSpan={5} className="text-right text-sm font-medium text-stone-600">
                  合计
                </TableCell>
                <TableCell className="text-right text-base font-bold tabular-nums text-stone-900">
                  {formatMoney(order.total_amount)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      {/* 弹窗 */}
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="确认销售订单"
        description={`确认后订单「${order.order_no}」将正式生效，不可再修改明细。确定继续吗？`}
        actionLabel="确认订单"
        endpoint={`/api/so/orders/${order.id}/confirm`}
        onDone={load}
      />
      <ConfirmActionDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="取消销售订单"
        description={`取消后订单「${order.order_no}」将作废，此操作不可恢复。确定继续吗？`}
        actionLabel="取消订单"
        endpoint={`/api/so/orders/${order.id}/cancel`}
        destructive
        onDone={load}
      />
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        endpoint={`/api/so/orders/${order.id}`}
        name={order.order_no}
        onDeleted={() => router.replace('/sales/orders')}
      />
    </div>
  );
}
