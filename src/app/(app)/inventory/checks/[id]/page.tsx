'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import { useAuth } from '@/components/auth/auth-provider';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import { ApprovalPanel } from '@/components/purchase/approval-panel';
import { TradeStatusBadge } from '@/components/trade/trade-status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import type { InvCheck } from '@/lib/types';

function formatQty(value: number): string {
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 3 });
}

function formatTime(value: string | null): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '—';
}

export default function CheckDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const [doc, setDoc] = useState<InvCheck | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [savingCounts, setSavingCounts] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<InvCheck>(`/api/inv/checks/${params.id}`);
      setDoc(data);
      // 初始化实盘数输入框（已有值沿用）
      const next: Record<string, string> = {};
      for (const item of data.items ?? []) {
        next[item.id] = String(item.counted_quantity);
      }
      setCounts(next);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '盘点单加载失败');
      router.replace('/inventory/checks');
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
  const editable = doc.status === 'draft' || doc.status === 'rejected';
  const deletable = doc.status === 'draft';

  async function onSaveCounts() {
    if (!doc) return;
    const payloadItems = (doc.items ?? []).map((item) => {
      const raw = counts[item.id] ?? '';
      const value = Number(raw);
      return { id: item.id, counted_quantity: Number.isFinite(value) && raw !== '' ? value : Number(item.book_quantity) };
    });
    setSavingCounts(true);
    try {
      await apiFetch(`/api/inv/checks/${doc.id}`, {
        method: 'PUT',
        body: JSON.stringify({ items: payloadItems }),
      });
      toast.success('实盘数已保存');
      await load();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '保存失败');
    } finally {
      setSavingCounts(false);
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
            <h1 className="truncate text-lg font-bold text-stone-900">{doc.check_no}</h1>
            <TradeStatusBadge status={doc.status} />
          </div>
          <p className="text-xs text-stone-500 sm:text-sm">
            盘点仓库：{doc.warehouse_name ?? '—'}
            {doc.approved_at ? ` · 过账于 ${formatTime(doc.approved_at)}` : ''}
          </p>
        </div>
        {canWrite && editable ? (
          <Button size="sm" variant="outline" disabled={savingCounts} onClick={() => void onSaveCounts()}>
            <Save className="mr-1 h-4 w-4" />
            {savingCounts ? '保存中…' : '保存实盘数'}
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
                  <TableHead className="text-right">账面数量</TableHead>
                  <TableHead className="w-32 text-right">实盘数量</TableHead>
                  <TableHead className="text-right">差异</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(doc.items ?? []).map((item) => {
                  const raw = counts[item.id] ?? String(item.counted_quantity);
                  const counted = Number(raw);
                  const diff =
                    raw !== '' && Number.isFinite(counted) ? counted - Number(item.book_quantity) : 0;
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="max-w-40 truncate font-medium text-stone-800">{item.product_name}</div>
                        <div className="font-mono text-xs text-stone-500">
                          {item.sku_code ?? ''}
                          {item.color_name
                            ? ` · ${item.color_name}(${item.color_code})`
                            : item.color_code
                              ? ` · ${item.color_code}`
                              : ''}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-stone-700">
                        {formatQty(Number(item.book_quantity))} {item.unit ?? ''}
                      </TableCell>
                      <TableCell className="text-right">
                        {editable ? (
                          <Input
                            type="number"
                            min="0"
                            step="any"
                            className="ml-auto h-8 w-28 text-right tabular-nums"
                            value={raw}
                            onChange={(e) => setCounts({ ...counts, [item.id]: e.target.value })}
                          />
                        ) : (
                          <span className="tabular-nums text-stone-700">
                            {formatQty(Number(item.counted_quantity))}
                          </span>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium tabular-nums ${
                          diff > 0 ? 'text-green-700' : diff < 0 ? 'text-red-600' : 'text-stone-400'
                        }`}
                      >
                        {diff > 0 ? `+${formatQty(diff)}` : diff < 0 ? formatQty(diff) : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {(doc.items ?? []).length === 0 ? (
              <p className="p-6 text-center text-sm text-stone-500">该仓库暂无账面库存，盘点单无明细</p>
            ) : null}
          </div>
          {editable ? (
            <p className="text-xs text-stone-500">
              提示：修改实盘数后请先「保存实盘数」再提交审批；差异 = 实盘 − 账面，审批通过后自动过账（盘盈入库 / 盘亏出库）。
            </p>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm">
            <h3 className="mb-2 font-medium text-stone-900">单据信息</h3>
            <dl className="space-y-1.5 text-xs text-stone-600">
              <div className="flex justify-between">
                <dt>盘点仓库</dt>
                <dd>{doc.warehouse_name ?? '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt>明细行数</dt>
                <dd>{(doc.items ?? []).length}</dd>
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
            docType="check"
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
        endpoint={`/api/inv/checks/${doc.id}`}
        name={`盘点单 ${doc.check_no}`}
        onDeleted={() => router.replace('/inventory/checks')}
      />
    </div>
  );
}
