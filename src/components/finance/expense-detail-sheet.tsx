'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Wallet } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { useAuth } from '@/components/auth/auth-provider';
import { formatMoney } from '@/components/finance/balance-list';
import { ApprovalPanel } from '@/components/purchase/approval-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ApprovalStep } from '@/lib/types';

interface ExpenseItemView {
  id: string;
  line_no: number;
  subject_code: string;
  subject_name: string;
  summary: string | null;
  amount: number;
  tax_rate: number;
  excl_amount: number;
  tax_amount: number;
}

interface ExpenseClaimDetail {
  id: string;
  claim_no: string;
  applicant: string;
  dept: string | null;
  claim_date: string;
  period: string;
  payee: string | null;
  pay_account: string | null;
  status: string;
  total_amount: number;
  excl_amount: number;
  tax_amount: number;
  approval_level: number | null;
  current_step: number;
  voucher_no: string | null;
  payment_id: string | null;
  reject_reason: string | null;
  remark: string | null;
  items: ExpenseItemView[];
  steps: ApprovalStep[];
}

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  pending: '待审核',
  approved: '已审核',
  paid: '已付款',
  rejected: '已驳回',
};

const ROLE_LABEL: Record<string, string> = {
  admin: '系统管理员',
  manager: '经理',
  staff: '员工',
};

function normalizeSteps(raw: unknown[]): ApprovalStep[] {
  return (raw ?? []).map((s) => {
    const r = s as Record<string, unknown>;
    const role = String(r.approver_role ?? '');
    return {
      step_no: Number(r.step_no ?? 0),
      approver_role: role,
      approver_role_label: (r.approver_role_label as string) ?? ROLE_LABEL[role] ?? role,
      status: r.status as ApprovalStep['status'],
      approver_name: (r.approver_name as string | null) ?? null,
      comment: (r.comment as string | null) ?? null,
      acted_at: (r.acted_at as string | null) ?? null,
    };
  });
}

export function ExpenseDetailSheet({
  expenseId,
  onOpenChange,
  onChanged,
}: {
  expenseId: string | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { can } = useAuth();
  const canWrite = can('fin.write');
  const canApprove = can('fin.write');
  const [detail, setDetail] = useState<ExpenseClaimDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState('bank');
  const [paidAt, setPaidAt] = useState('');

  const load = useCallback(async () => {
    if (!expenseId) return;
    setLoading(true);
    try {
      const data = await apiFetch<ExpenseClaimDetail & { steps: unknown[] }>(`/api/fin/expenses/${expenseId}`);
      setDetail({ ...data, steps: normalizeSteps(data.steps ?? []) });
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '加载报销单失败');
    } finally {
      setLoading(false);
    }
  }, [expenseId]);

  useEffect(() => {
    if (expenseId) void load();
    else setDetail(null);
  }, [expenseId, load]);

  function refresh() {
    void load();
    onChanged();
  }

  async function doPay() {
    if (!detail) return;
    setPaying(true);
    try {
      await apiFetch(`/api/fin/expenses/${detail.id}/pay`, {
        method: 'POST',
        body: JSON.stringify({ method, paid_at: paidAt || undefined }),
      });
      toast.success('已登记付款并生成付款凭证');
      setPayOpen(false);
      refresh();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '付款失败');
    } finally {
      setPaying(false);
    }
  }

  const open = expenseId !== null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>费用报销单</SheetTitle>
            <SheetDescription>
              {detail ? `${detail.claim_no} · ${detail.applicant}` : '加载中…'}
            </SheetDescription>
          </SheetHeader>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-stone-400" />
            </div>
          ) : detail ? (
            <div className="space-y-5 px-1 pb-8">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-stone-300">
                  {STATUS_LABEL[detail.status] ?? detail.status}
                </Badge>
                <span className="text-sm text-stone-500">
                  {detail.claim_date} · {detail.period}
                </span>
              </div>

              <dl className="grid grid-cols-2 gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
                <div>
                  <dt className="text-xs text-stone-500">报销人 / 部门</dt>
                  <dd className="mt-0.5 font-medium text-stone-900">{detail.applicant} / {detail.dept ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">含税合计</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums text-stone-900">¥{formatMoney(detail.total_amount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">不含税 / 税额</dt>
                  <dd className="mt-0.5 tabular-nums text-stone-800">
                    {formatMoney(detail.excl_amount)} / {formatMoney(detail.tax_amount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-stone-500">凭证号 / 付款单</dt>
                  <dd className="mt-0.5 font-mono text-xs text-stone-800">
                    {detail.voucher_no ?? '—'} / {detail.payment_id ? '已付款' : '—'}
                  </dd>
                </div>
              </dl>

              <div className="rounded-lg border border-stone-200">
                <div className="border-b bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700">费用明细</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>费用科目</TableHead>
                      <TableHead>摘要</TableHead>
                      <TableHead className="text-right">含税</TableHead>
                      <TableHead className="text-right">税率</TableHead>
                      <TableHead className="text-right">不含税</TableHead>
                      <TableHead className="text-right">税额</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.map((it) => (
                      <TableRow key={it.id ?? it.line_no}>
                        <TableCell className="text-sm">{it.subject_name}</TableCell>
                        <TableCell className="text-sm text-stone-600">{it.summary ?? '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(it.amount)}</TableCell>
                        <TableCell className="text-right tabular-nums text-stone-500">{it.tax_rate}%</TableCell>
                        <TableCell className="text-right tabular-nums text-stone-600">{formatMoney(it.excl_amount)}</TableCell>
                        <TableCell className="text-right tabular-nums text-stone-600">{formatMoney(it.tax_amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {detail.remark ? (
                <p className="rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-600">备注：{detail.remark}</p>
              ) : null}

              <ApprovalPanel
                docType="expense"
                docId={detail.id}
                status={detail.status}
                steps={detail.steps}
                currentStep={detail.current_step}
                approvalLevel={detail.approval_level}
                rejectReason={detail.reject_reason}
                canWrite={canWrite}
                canApprove={canApprove}
                onChanged={refresh}
              />

              {detail.status === 'approved' && canWrite ? (
                <Button className="w-full" onClick={() => setPayOpen(true)}>
                  <Wallet className="mr-1 h-4 w-4" />
                  登记付款并生成付款凭证
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="py-16 text-center text-sm text-stone-500">报销单不存在</p>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>登记付款</DialogTitle>
            <DialogDescription>
              付款金额 ¥{detail ? formatMoney(detail.total_amount) : '0.00'}，将生成「借 其他应付款 / 贷 银行存款」付款凭证
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm text-stone-600" htmlFor="pay-method">付款方式</label>
              <select
                id="pay-method"
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="h-9 w-full rounded-md border border-stone-200 bg-white px-2 text-sm"
              >
                <option value="bank">银行转账</option>
                <option value="cash">现金</option>
                <option value="wechat">微信</option>
                <option value="alipay">支付宝</option>
                <option value="other">其他</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-stone-600" htmlFor="pay-date">付款日期（可选）</label>
              <Input id="pay-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(false)}>
              取消
            </Button>
            <Button disabled={paying} onClick={doPay}>
              {paying ? '处理中…' : '确认付款'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
