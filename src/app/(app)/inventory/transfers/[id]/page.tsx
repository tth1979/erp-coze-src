'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, PackageCheck, Trash2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import { ApprovalPanel } from '@/components/purchase/approval-panel';
import { TradeStatusBadge } from '@/components/trade/trade-status-badge';
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
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { InvTransfer } from '@/lib/types';

function formatQty(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
}

function formatTime(value: string | null): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '—';
}

export default function TransferDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const [doc, setDoc] = useState<InvTransfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [receiving, setReceiving] = useState(false);

  const load = useCallback(async () => {
    try {
      setDoc(await apiFetch<InvTransfer>(`/api/inv/transfers/${params.id}`));
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '调拨单加载失败');
      router.replace('/inventory/transfers');
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
  if (!doc) return null;

  const canWrite = can('inv.write');
  const canApprove = can('inv.approve');
  const deletable = doc.status === 'draft';
  const receivable = doc.status === 'approved';

  async function onReceive() {
    setReceiving(true);
    try {
      await apiFetch(`/api/inv/transfers/${params.id}/receive`, { method: 'POST' });
      toast.success('收货完成，已计入调入仓库存');
      await load();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '收货失败');
    } finally {
      setReceiving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.back()} aria-label="返回">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-bold text-stone-900">{doc.transfer_no}</h1>
            <TradeStatusBadge status={doc.status} />
          </div>
          <p className="text-xs text-stone-500 sm:text-sm">
            {doc.from_warehouse_name ?? '—'} → {doc.to_warehouse_name ?? '—'}
            {doc.received_at ? ` · 收货于 ${formatTime(doc.received_at)}` : ''}
          </p>
        </div>
        {canWrite && receivable ? (
          <Button size="sm" disabled={receiving} onClick={() => void onReceive()}>
            <PackageCheck className="mr-1 h-4 w-4" />
            {receiving ? '收货中…' : '确认收货入库'}
          </Button>
        ) : null}
        {canWrite && deletable ? (
          <Button
            size="sm"
            variant="outline"
            className="text-red-700 hover:text-red-800"
            onClick={() => setDeleteOpen(true)}
          >
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
                  <TableHead className="text-right">调拨数量</TableHead>
                  <TableHead className="text-right">调出成本快照</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(doc.items ?? []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-40 truncate font-medium text-stone-800">{item.product_name}</TableCell>
                    <TableCell className="font-mono text-xs text-stone-600">{item.sku_code ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatQty(Number(item.quantity))} {item.unit ?? ''}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-stone-600">
                      {item.unit_cost !== null
                        ? `¥${Number(item.unit_cost).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        : '—（审批后生成）'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
            <h3 className="mb-2 font-medium text-stone-900">单据信息</h3>
            <dl className="space-y-1.5 text-xs text-stone-600">
              <div className="flex justify-between">
                <dt>调出仓</dt>
                <dd>{doc.from_warehouse_name ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>调入仓</dt>
                <dd>{doc.to_warehouse_name ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>创建时间</dt>
                <dd>{formatTime(doc.created_at)}</dd>
              </div>
              {doc.remark ? (
                <div className="flex justify-between">
                  <dt>备注</dt>
                  <dd>{doc.remark}</dd>
                </div>
              ) : null}
            </dl>
          </div>

          <ApprovalPanel
            docType="transfer"
            docId={doc.id}
            status={doc.status}
            steps={doc.steps ?? []}
            currentStep={doc.current_step ?? 0}
            approvalLevel={doc.approval_level}
            rejectReason={doc.reject_reason}
            canWrite={canWrite}
            canApprove={canApprove}
            onChanged={() => void load()}
          />
        </div>
      </div>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        endpoint={`/api/inv/transfers/${doc.id}`}
        name={`调拨单 ${doc.transfer_no}`}
        onDeleted={() => router.replace('/inventory/transfers')}
      />
    </div>
  );
}
