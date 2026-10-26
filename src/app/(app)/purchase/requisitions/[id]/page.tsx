'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRightCircle, Trash2 } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { useAuth } from '@/components/auth/auth-provider';
import type { PoRequisition, Supplier } from '@/lib/types';
import { TradeStatusBadge } from '@/components/trade/trade-status-badge';
import { ApprovalPanel } from '@/components/purchase/approval-panel';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  return value.slice(0, 16).replace('T', ' ');
}

export default function RequisitionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const id = params.id;

  const [doc, setDoc] = useState<PoRequisition | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<PoRequisition>(`/api/po/requisitions/${id}`)
      .then(setDoc)
      .catch((error: unknown) => {
        toast.error(error instanceof ApiClientError ? error.message : '申请单加载失败');
        router.replace('/purchase/requisitions');
      })
      .finally(() => setLoading(false));
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !doc) {
    return (
      <div className="mx-auto max-w-4xl space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const writable = can('po.write');
  const items = doc.items ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push('/purchase/requisitions')} aria-label="返回列表">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-lg font-bold text-stone-900">{doc.req_no}</h1>
            <TradeStatusBadge status={doc.status} />
          </div>
          <p className="text-xs text-stone-500 sm:text-sm">{doc.reason ?? '采购申请'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {writable && doc.status === 'approved' && !doc.converted_order_id ? (
            <Button size="sm" onClick={() => setConvertOpen(true)}>
              <ArrowRightCircle className="mr-1 h-4 w-4" />
              转采购订单
            </Button>
          ) : null}
          {doc.converted_order_no ? (
            <Button variant="outline" size="sm" onClick={() => router.push(`/purchase/orders/${doc.converted_order_id}`)}>
              查看订单 {doc.converted_order_no}
            </Button>
          ) : null}
          {writable && doc.status === 'draft' ? (
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="mr-1 h-4 w-4" />
              删除
            </Button>
          ) : null}
        </div>
      </div>

      <ApprovalPanel
        docType="requisition"
        docId={doc.id}
        status={doc.status}
        steps={doc.steps ?? []}
        currentStep={doc.current_step}
        approvalLevel={doc.approval_level}
        rejectReason={doc.reject_reason}
        canWrite={writable}
        canApprove={can('po.approve')}
        onChanged={load}
      />

      <div className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm md:grid-cols-4">
          <div>
            <dt className="text-xs text-stone-500">预估金额</dt>
            <dd className="mt-0.5 font-medium tabular-nums text-stone-800">{formatMoney(doc.total_estimate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">创建人</dt>
            <dd className="mt-0.5 text-stone-800">{doc.created_by_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">提交时间</dt>
            <dd className="mt-0.5 tabular-nums text-stone-800">{formatTime(doc.submitted_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">审批时间</dt>
            <dd className="mt-0.5 tabular-nums text-stone-800">{formatTime(doc.approved_at)}</dd>
          </div>
          {doc.remark ? (
            <div className="col-span-2 md:col-span-4">
              <dt className="text-xs text-stone-500">备注</dt>
              <dd className="mt-0.5 text-stone-800">{doc.remark}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>商品</TableHead>
              <TableHead className="text-right">数量</TableHead>
              <TableHead className="text-right">建议价</TableHead>
              <TableHead className="text-right">预估金额</TableHead>
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
                <TableCell className="text-right tabular-nums">
                  {item.quantity}
                  {item.unit ?? ''}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(item.suggest_price)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(item.amount)}</TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-stone-50">
              <TableCell colSpan={4} className="text-right text-sm font-medium text-stone-600">
                合计
              </TableCell>
              <TableCell className="text-right text-base font-bold tabular-nums text-stone-900">
                {formatMoney(doc.total_estimate)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <ConvertDialog doc={doc} open={convertOpen} onOpenChange={setConvertOpen} onDone={load} />
      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        endpoint={`/api/po/requisitions/${doc.id}`}
        name={doc.req_no}
        onDeleted={() => router.replace('/purchase/requisitions')}
      />
    </div>
  );
}

/** 转采购订单对话框：选择供应商，可微调单价后生成 draft 订单 */
function ConvertDialog({
  doc,
  open,
  onOpenChange,
  onDone,
}: {
  doc: PoRequisition;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [suppliers, setSuppliers] = useState<Supplier[] | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    apiFetch<{ items: Supplier[] }>('/api/md/suppliers?page=1&pageSize=100&status=active')
      .then((res) => setSuppliers(res.items))
      .catch(() => setSuppliers([]));
    const initial: Record<string, string> = {};
    for (const item of doc.items ?? []) initial[item.product_id] = String(item.suggest_price);
    setPrices(initial);
    setSupplierId('');
  }, [open, doc.items]);

  async function onSubmit() {
    if (!supplierId) {
      toast.error('请选择供应商');
      return;
    }
    setSaving(true);
    try {
      await apiFetch(`/api/po/requisitions/${doc.id}/convert`, {
        method: 'POST',
        body: JSON.stringify({
          supplier_id: supplierId,
          items: (doc.items ?? []).map((item) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: Number(prices[item.product_id] ?? item.suggest_price) || 0,
          })),
        }),
      });
      toast.success('已生成采购订单草稿');
      onOpenChange(false);
      onDone();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '转换失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>转采购订单</DialogTitle>
          <DialogDescription>选择供应商并按需调整采购单价，确认后生成采购订单草稿。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>供应商</Label>
            <Select value={supplierId || undefined} onValueChange={setSupplierId}>
              <SelectTrigger>
                <SelectValue placeholder={suppliers === null ? '加载中…' : '选择供应商'} />
              </SelectTrigger>
              <SelectContent>
                {(suppliers ?? []).map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id}>
                    {supplier.code} · {supplier.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {(doc.items ?? []).map((item) => (
              <div key={item.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-stone-700">
                  {item.product_name} × {item.quantity}
                  {item.unit ?? ''}
                </span>
                <Input
                  type="number"
                  min="0"
                  step="any"
                  className="h-8 w-28 text-right tabular-nums"
                  value={prices[item.product_id] ?? ''}
                  onChange={(e) => setPrices((prev) => ({ ...prev, [item.product_id]: e.target.value }))}
                />
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button disabled={saving || !supplierId} onClick={() => void onSubmit()}>
            {saving ? '生成中…' : '生成订单草稿'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
