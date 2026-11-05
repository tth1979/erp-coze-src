'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, Ban, CheckCircle2, Pencil, Send, Trash2, ArrowRightLeft } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { useAuth } from '@/components/auth/auth-provider';
import type { Quote } from '@/lib/types';
import { QuoteEditor } from '@/components/sales/quote-editor';
import { DeleteConfirmDialog } from '@/components/master-data/delete-confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  sent: '已发出',
  accepted: '已接受',
  converted: '已转订单',
  expired: '已过期',
  void: '已作废',
};

export default function QuoteDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can, user } = useAuth();
  const id = params.id;

  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [convertOpen, setConvertOpen] = useState(false);
  const [forceReason, setForceReason] = useState('');
  const [forceNeeded, setForceNeeded] = useState(false);
  const [acting, setActing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch<Quote>(`/api/sales/quotes/${id}`)
      .then(setQuote)
      .catch((error: unknown) => {
        toast.error(error instanceof ApiClientError ? error.message : '报价单加载失败');
        router.replace('/sales/quotes');
      })
      .finally(() => setLoading(false));
  }, [id, router]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading || !quote) {
    return (
      <div className="mx-auto max-w-4xl space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const writable = can('so.write');
  const canApprove = can('so.approve');
  const editable = quote.status === 'draft';
  const items = quote.items ?? [];

  if (editing && editable) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditing(false)} aria-label="返回详情">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-bold text-stone-900">编辑报价单</h1>
            <p className="text-xs text-stone-500 sm:text-sm">
              单号 <span className="font-mono">{quote.quote_no}</span>
            </p>
          </div>
        </div>
        <QuoteEditor
          mode="edit"
          initial={quote}
          onSaved={() => {
            setEditing(false);
            load();
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  async function doAction(endpoint: string, body?: Record<string, unknown>): Promise<boolean> {
    setActing(true);
    try {
      await apiFetch(`/api/sales/quotes/${id}/${endpoint}`, {
        method: 'POST',
        body: body ? JSON.stringify(body) : undefined,
      });
      load();
      return true;
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '操作失败');
      return false;
    } finally {
      setActing(false);
    }
  }

  async function onConvert(force?: string) {
    setActing(true);
    try {
      await apiFetch<Quote>(`/api/sales/quotes/${id}/convert`, {
        method: 'POST',
        body: force ? JSON.stringify({ force_reason: force }) : undefined,
      });
      toast.success('已转销售订单');
      setConvertOpen(false);
      setForceReason('');
      setForceNeeded(false);
      load();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === 'CREDIT.EXCEEDED') {
        if (canApprove) {
          setForceNeeded(true);
          toast.error(`${error.message}；可填写原因强制通过`);
        } else {
          toast.error(error.message);
        }
      } else {
        toast.error(error instanceof ApiClientError ? error.message : '转订单失败');
      }
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* 标题行 */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push('/sales/quotes')} aria-label="返回列表">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-stone-900">报价单</h1>
            <Badge variant={quote.status === 'void' ? 'destructive' : quote.status === 'converted' ? 'outline' : 'default'}>
              {STATUS_LABELS[quote.status] ?? quote.status}
            </Badge>
          </div>
          <p className="font-mono text-xs text-stone-500 sm:text-sm">{quote.quote_no}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {writable && editable ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-1 h-4 w-4" />
              编辑
            </Button>
          ) : null}
          {writable && quote.status === 'draft' ? (
            <Button size="sm" disabled={acting} onClick={() => void doAction('submit').then((okFlag) => okFlag && toast.success('已发出'))}>
              <Send className="mr-1 h-4 w-4" />
              发出报价
            </Button>
          ) : null}
          {writable && quote.status === 'sent' ? (
            <Button size="sm" disabled={acting} onClick={() => void doAction('accept').then((okFlag) => okFlag && toast.success('已接受'))}>
              <CheckCircle2 className="mr-1 h-4 w-4" />
              客户接受
            </Button>
          ) : null}
          {writable && (quote.status === 'sent' || quote.status === 'accepted') ? (
            <Button size="sm" variant="secondary" disabled={acting} onClick={() => setConvertOpen(true)}>
              <ArrowRightLeft className="mr-1 h-4 w-4" />
              转销售订单
            </Button>
          ) : null}
          {writable && ['draft', 'sent', 'accepted', 'expired'].includes(quote.status) ? (
            <Button variant="destructive" size="sm" onClick={() => setVoidOpen(true)}>
              <Ban className="mr-1 h-4 w-4" />
              作废
            </Button>
          ) : null}
          {writable && quote.status === 'draft' ? (
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteOpen(true)} aria-label="删除">
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* 单据头 */}
      <div className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-stone-500">客户</dt>
            <dd className="mt-0.5 text-stone-900">{quote.customer_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">报价日期</dt>
            <dd className="mt-0.5 text-stone-900">{quote.quote_date}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">有效期至</dt>
            <dd className="mt-0.5 text-stone-900">{quote.valid_until ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">业务员</dt>
            <dd className="mt-0.5 text-stone-900">{quote.salesman ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">创建人</dt>
            <dd className="mt-0.5 text-stone-900">{quote.created_by_name ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-stone-500">创建时间</dt>
            <dd className="mt-0.5 text-stone-900">{formatTime(quote.created_at)}</dd>
          </div>
          {quote.converted_order_no ? (
            <div>
              <dt className="text-xs text-stone-500">已转订单</dt>
              <dd className="mt-0.5">
                <button
                  type="button"
                  className="font-mono text-xs text-primary underline-offset-2 hover:underline"
                  onClick={() => router.push(`/sales/orders/${quote.converted_order_id}`)}
                >
                  {quote.converted_order_no}
                </button>
              </dd>
            </div>
          ) : null}
          {quote.void_reason ? (
            <div className="col-span-2">
              <dt className="text-xs text-stone-500">作废原因</dt>
              <dd className="mt-0.5 text-stone-900">{quote.void_reason}</dd>
            </div>
          ) : null}
          {quote.remark ? (
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-xs text-stone-500">备注</dt>
              <dd className="mt-0.5 text-stone-900">{quote.remark}</dd>
            </div>
          ) : null}
        </dl>
      </div>

      {/* 明细 */}
      <div className="rounded-lg border border-stone-200 bg-white shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>商品</TableHead>
              <TableHead>色号</TableHead>
              <TableHead className="text-right">数量</TableHead>
              <TableHead>单位</TableHead>
              <TableHead className="text-right">含税单价</TableHead>
              <TableHead className="text-right">折扣率</TableHead>
              <TableHead className="text-right">税率</TableHead>
              <TableHead className="text-right">金额</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <div className="text-sm font-medium text-stone-900">{item.product_name ?? '—'}</div>
                  <div className="font-mono text-xs text-stone-500">{item.product_sku ?? ''}</div>
                </TableCell>
                <TableCell className="text-stone-600">{item.color_name ?? (item.color_code ? item.color_code : '默认色')}</TableCell>
                <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                <TableCell className="text-stone-600">{item.unit ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(item.unit_price)}</TableCell>
                <TableCell className="text-right tabular-nums">{item.discount_rate}%</TableCell>
                <TableCell className="text-right tabular-nums">{item.tax_rate}%</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(item.amount)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-end gap-3 border-t border-stone-100 px-4 py-3">
          <span className="text-sm text-stone-500">合计金额（折后）</span>
          <span className="text-lg font-bold tabular-nums text-stone-900">{formatMoney(quote.total_amount)}</span>
        </div>
      </div>

      {/* 作废弹窗 */}
      <Dialog open={voidOpen} onOpenChange={setVoidOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>作废报价单</DialogTitle>
            <DialogDescription>作废后不可恢复，且不可再转销售订单。请填写作废原因。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="void-reason">作废原因 *</Label>
            <Input id="void-reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} maxLength={200} placeholder="例如：客户取消需求" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidOpen(false)} disabled={acting}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={acting || !voidReason.trim()}
              onClick={() => {
                void doAction('void', { reason: voidReason.trim() }).then((okFlag) => {
                  if (okFlag) {
                    toast.success('报价单已作废');
                    setVoidOpen(false);
                    setVoidReason('');
                  }
                });
              }}
            >
              确认作废
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 转订单弹窗（含信用强制通过） */}
      <Dialog open={convertOpen} onOpenChange={(open) => { setConvertOpen(open); if (!open) { setForceNeeded(false); setForceReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>转销售订单</DialogTitle>
            <DialogDescription>
              将按报价明细生成销售订单草稿（单价=含税单价×折扣率），并回写报价单状态为「已转订单」。转单前会校验客户信用额度。
            </DialogDescription>
          </DialogHeader>
          {forceNeeded ? (
            <div className="space-y-2">
              <Label htmlFor="force-reason">信用超限强制通过原因 *（{user?.display_name ?? ''}，需 so.approve 权限，将记录审计日志）</Label>
              <Input
                id="force-reason"
                value={forceReason}
                onChange={(e) => setForceReason(e.target.value)}
                maxLength={200}
                placeholder="例如：客户已承诺回款计划，总经理特批"
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConvertOpen(false)} disabled={acting}>
              取消
            </Button>
            <Button
              disabled={acting || (forceNeeded && !forceReason.trim())}
              onClick={() => void onConvert(forceNeeded ? forceReason.trim() : undefined)}
            >
              {forceNeeded ? '强制通过并转订单' : '确认转订单'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        endpoint={`/api/sales/quotes/${id}`}
        name={quote.quote_no}
        onDeleted={() => router.replace('/sales/quotes')}
      />
    </div>
  );
}
