'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Ban, PackageCheck, PackagePlus, Pencil, Trash2 } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { useAuth } from '@/components/auth/auth-provider';
import type { PurchaseOrder } from '@/lib/types';
import { OrderEditor } from '@/components/trade/order-editor';
import { TradeStatusBadge } from '@/components/trade/trade-status-badge';
import { ConfirmActionDialog } from '@/components/trade/confirm-action-dialog';
import { ApprovalPanel } from '@/components/purchase/approval-panel';
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

export default function PurchaseOrderDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const id = params.id;

  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<PurchaseOrder>(`/api/po/orders/${id}`)
      .then(setOrder)
      .catch((error: unknown) => {
        toast.error(error instanceof ApiClientError ? error.message : '订单加载失败');
        router.replace('/purchase/orders');
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

  const writable = can('po.write');
  const editable = order.status === 'draft' || order.status === 'rejected';

  // 编辑模式（草稿/已驳回）
  if (editing && editable) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(false)} aria-label="返回详情">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-bold text-stone-900">编辑采购订单</h1>
            <p className="text-xs text-stone-500 sm:text-sm">
              单号 <span className="font-mono">{order.order_no}</span>
            </p>
          </div>
        </div>
        <OrderEditor
          kind="purchase"
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
          onClick={() => router.push('/purchase/orders')}
          aria-label="返回列表"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-lg font-bold text-stone-900">{order.order_no}</h1>
            <TradeStatusBadge status={order.status} />
          </div>
          <p className="text-xs text-stone-500 sm:text-sm">{order.supplier_name ?? '供应商已删除'}</p>
        </div>
        {writable && editable ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-1 h-4 w-4" />
              编辑
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>
              <Ban className="mr-1 h-4 w-4" />
              关闭
            </Button>
            {order.status === 'draft' ? (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="mr-1 h-4 w-4" />
                删除
              </Button>
            ) : null}
          </div>
        ) : null}
        {writable && order.status === 'pending' ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>
              <Ban className="mr-1 h-4 w-4" />
              关闭
            </Button>
          </div>
        ) : null}
        {writable && order.status === 'approved' ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setCompleteOpen(true)}>
              <PackageCheck className="mr-1 h-4 w-4" />
              到货入库
            </Button>
            <Button variant="outline" size="sm" onClick={() => router.push(`/purchase/receipts/new?order=${order.id}`)}>
              <PackagePlus className="mr-1 h-4 w-4" />
              创建入库单
            </Button>
          </div>
        ) : null}
      </div>

      {/* 审批流程（提交/通过/驳回 + 步骤时间线） */}
      <ApprovalPanel
        docType="order"
        docId={order.id}
        status={order.status}
        steps={order.steps ?? []}
        currentStep={order.current_step}
        approvalLevel={order.approval_level}
        rejectReason={order.reject_reason}
        canWrite={writable}
        canApprove={can('po.approve')}
        onChanged={load}
      />

      {/* 单据头 */}
      <div className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
          <div>
            <dt className="text-xs text-stone-500">供应商</dt>
            <dd className="mt-0.5 text-stone-800">{order.supplier_name ?? '—'}</dd>
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
            <dt className="text-xs text-stone-500">审批时间</dt>
            <dd className="mt-0.5 tabular-nums text-stone-800">{formatTime(order.approved_at)}</dd>
          </div>
          {order.requisition_no ? (
            <div>
              <dt className="text-xs text-stone-500">来源申请单</dt>
              <dd className="mt-0.5 font-mono text-stone-800">{order.requisition_no}</dd>
            </div>
          ) : null}
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
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="关闭采购订单"
        description={`关闭后订单「${order.order_no}」将终止流转，此操作不可恢复。确定继续吗？`}
        actionLabel="关闭订单"
        endpoint={`/api/po/orders/${order.id}/cancel`}
        destructive
        onDone={load}
      />
      <ConfirmActionDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title="采购到货入库"
        description={`确认订单「${order.order_no}」已到货？系统将自动生成一张已审核的正式入库单并按明细整单入库（移动加权成本同步更新），此操作不可撤销。`}
        actionLabel="确认到货入库"
        endpoint={`/api/po/orders/${order.id}/complete`}
        onDone={load}
      />
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        endpoint={`/api/po/orders/${order.id}`}
        name={order.order_no}
        onDeleted={() => router.replace('/purchase/orders')}
      />
    </div>
  );
}
