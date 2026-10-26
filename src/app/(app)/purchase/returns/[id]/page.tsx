'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Trash2 } from 'lucide-react';
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
import type { PoReturn } from '@/lib/types';

function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ReturnDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const [doc, setDoc] = useState<PoReturn | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setDoc(await apiFetch<PoReturn>(`/api/po/returns/${params.id}`));
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '退货单加载失败');
      router.replace('/purchase/returns');
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

  const canWrite = can('po.write');
  const deletable = doc.status === 'draft' || doc.status === 'rejected';

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.back()} aria-label="返回">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-bold text-stone-900">{doc.return_no}</h1>
            <TradeStatusBadge status={doc.status} />
          </div>
          <p className="text-xs text-stone-500 sm:text-sm">
            {doc.supplier_name} · 退货日期 {doc.return_date}
            {doc.order_no ? (
              <>
                {' '}· 关联订单{' '}
                <Link href={`/purchase/orders/${doc.order_id}`} className="font-mono text-orange-700 hover:underline">
                  {doc.order_no}
                </Link>
              </>
            ) : null}
          </p>
        </div>
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
                  <TableHead className="text-right">数量</TableHead>
                  <TableHead className="text-right">单价</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(doc.items ?? []).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-40 truncate font-medium text-stone-800">{item.product_name}</TableCell>
                    <TableCell className="font-mono text-xs text-stone-600">{item.product_sku ?? '—'}</TableCell>
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
              <span className="text-stone-500">{doc.reason}</span>
              <span className="font-semibold tabular-nums text-stone-900">
                合计 {formatMoney(doc.total_amount)}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
            <h3 className="mb-2 font-medium text-stone-900">单据信息</h3>
            <dl className="space-y-1.5 text-xs text-stone-600">
              <div className="flex justify-between">
                <dt>申请人</dt>
                <dd>{doc.created_by_name ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>创建时间</dt>
                <dd>{new Date(doc.created_at).toLocaleString('zh-CN', { hour12: false })}</dd>
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
            docType="return"
            docId={doc.id}
            status={doc.status}
            steps={doc.steps ?? []}
            currentStep={doc.current_step}
            approvalLevel={doc.approval_level}
            rejectReason={doc.reject_reason}
            canWrite={canWrite}
            canApprove={can('po.approve')}
            onChanged={() => void load()}
          />
        </div>
      </div>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        endpoint={`/api/po/returns/${doc.id}`}
        name={doc.return_no}
        onDeleted={() => router.replace('/purchase/returns')}
      />
    </div>
  );
}
