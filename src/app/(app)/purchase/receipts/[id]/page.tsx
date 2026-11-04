'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Trash2, Undo2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import { ApprovalPanel } from '@/components/purchase/approval-panel';
import { buildDocItems, DocItemEditor, newDocItem, type DocItemRow } from '@/components/purchase/doc-item-editor';
import { TradeStatusBadge } from '@/components/trade/trade-status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { PoReceipt } from '@/lib/types';

function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 暂估冲回对话框：录入发票号与实际明细，系统生成红蓝字单 */
function ReverseDialog({
  receipt,
  open,
  onOpenChange,
  onDone,
}: {
  receipt: PoReceipt;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [invoiceNo, setInvoiceNo] = useState('');
  const [items, setItems] = useState<DocItemRow[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setInvoiceNo(receipt.invoice_no ?? '');
      setItems(
        (receipt.items ?? []).map((item) =>
          newDocItem(item.product_id, String(item.quantity), String(item.unit_price)),
        ),
      );
    }
  }, [open, receipt]);

  async function onSubmit() {
    if (!invoiceNo.trim()) {
      toast.error('请填写发票号');
      return;
    }
    const built = buildDocItems(items);
    if (!built) {
      toast.error('请完善蓝字明细：商品、数量与发票单价');
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/po/receipts/${receipt.id}/reverse`, {
        method: 'POST',
        body: JSON.stringify({ invoice_no: invoiceNo.trim(), items: built }),
      });
      toast.success('冲回完成：红字冲销暂估，蓝字按发票价重入');
      onOpenChange(false);
      onDone();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '冲回失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>暂估冲回 · {receipt.receipt_no}</DialogTitle>
          <DialogDescription>
            红字冲销原暂估（{formatMoney(receipt.total_amount)}），按下方发票价蓝字重入；库存数量先出后入，成本按发票价重算。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invoice_no">
              发票号 <span className="text-red-600">*</span>
            </Label>
            <Input
              id="invoice_no"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              placeholder="供应商发票号码"
              maxLength={64}
            />
          </div>
          <div>
            <Label className="mb-2 block">蓝字明细（按发票实际价）</Label>
            <DocItemEditor items={items} onChange={setItems} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={saving} onClick={() => void onSubmit()}>
            {saving ? '执行中…' : '执行冲回'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ReceiptDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const [receipt, setReceipt] = useState<PoReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setReceipt(await apiFetch<PoReceipt>(`/api/po/receipts/${params.id}`));
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '入库单加载失败');
      router.replace('/purchase/receipts');
    } finally {
      setLoading(false);
    }
  }, [params.id, router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (!receipt) return null;

  const canWrite = can('po.write');
  const deletable = receipt.status === 'draft' || receipt.status === 'rejected';
  const reversible = receipt.status === 'approved' && receipt.is_estimated && !receipt.reversal_kind;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.back()} aria-label="返回">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-bold text-stone-900">{receipt.receipt_no}</h1>
            {receipt.is_estimated && !receipt.reversal_kind ? (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 font-normal text-amber-700">暂估</Badge>
            ) : null}
            {receipt.reversal_kind === 'red' ? (
              <Badge variant="outline" className="border-red-200 bg-red-50 font-normal text-red-700">红字冲回</Badge>
            ) : null}
            {receipt.reversal_kind === 'blue' ? (
              <Badge variant="outline" className="border-blue-200 bg-blue-50 font-normal text-blue-700">蓝字重入</Badge>
            ) : null}
            <TradeStatusBadge status={receipt.status} />
          </div>
          <p className="text-xs text-stone-500 sm:text-sm">
            {receipt.supplier_name} · 入库日期 {receipt.receive_date}
            {receipt.order_no ? (
              <>
                {' '}· 关联订单{' '}
                <Link href={`/purchase/orders/${receipt.order_id}`} className="font-mono text-orange-700 hover:underline">
                  {receipt.order_no}
                </Link>
              </>
            ) : null}
            {receipt.invoice_no ? ` · 发票 ${receipt.invoice_no}` : ''}
          </p>
        </div>
        {canWrite && reversible ? (
          <Button size="sm" variant="outline" onClick={() => setReverseOpen(true)}>
            <Undo2 className="mr-1 h-4 w-4" />
            暂估冲回
          </Button>
        ) : null}
        {canWrite && deletable ? (
          <Button size="sm" variant="outline" className="text-red-700 hover:text-red-800" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="mr-1 h-4 w-4" />
            删除
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>商品</TableHead>
                  <TableHead>编码</TableHead>
                  <TableHead>色号</TableHead>
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead className="text-right">单价</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(receipt.items ?? []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-40 truncate font-medium text-stone-800">{item.product_name}</TableCell>
                    <TableCell className="font-mono text-xs text-stone-600">{item.product_sku ?? '—'}</TableCell>
                    <TableCell className="text-xs text-stone-600">
                      {item.color_code ? (item.color_name ?? item.color_code) : <span className="text-stone-400">默认色</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.quantity} {item.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(item.unit_price)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(item.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between border-t border-stone-100 px-4 py-3 text-sm">
              <span className="text-stone-500">{receipt.remark || '—'}</span>
              <span className="font-semibold tabular-nums text-stone-900">
                合计 {formatMoney(receipt.total_amount)}
              </span>
            </div>
          </div>
          {receipt.reversal_of_id ? (
            <p className="text-xs text-stone-500">本单为冲回生成（{receipt.reversal_kind === 'red' ? '红字冲销' : '蓝字重入'}），与原暂估单对账平衡。</p>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
            <h3 className="mb-2 font-medium text-stone-900">单据信息</h3>
            <dl className="space-y-1.5 text-xs text-stone-600">
              <div className="flex justify-between">
                <dt>创建人</dt>
                <dd>{receipt.created_by_name ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>创建时间</dt>
                <dd>{new Date(receipt.created_at).toLocaleString('zh-CN', { hour12: false })}</dd>
              </div>
            </dl>
          </div>
          <ApprovalPanel
            docType="receipt"
            docId={receipt.id}
            status={receipt.status}
            steps={receipt.steps ?? []}
            currentStep={receipt.current_step}
            approvalLevel={receipt.approval_level}
            rejectReason={receipt.reject_reason}
            canWrite={canWrite}
            canApprove={can('po.approve')}
            onChanged={() => void load()}
          />
        </div>
      </div>

      <ReverseDialog receipt={receipt} open={reverseOpen} onOpenChange={setReverseOpen} onDone={() => void load()} />
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        endpoint={`/api/po/receipts/${receipt.id}`}
        name={receipt.receipt_no}
        onDeleted={() => router.replace('/purchase/receipts')}
      />
    </div>
  );
}
