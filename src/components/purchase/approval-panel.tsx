'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Send, XCircle } from 'lucide-react';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { ApprovalStep } from '@/lib/types';
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

/**
 * 审批面板（采购四单 + 销售三单通用）：审批步骤时间线 + 提交/通过/驳回操作。
 * 通过/驳回走当前步骤；角色匹配由服务端最终裁决。
 */

const API_BASE: Record<string, string> = {
  requisition: '/api/po/requisitions',
  order: '/api/po/orders',
  receipt: '/api/po/receipts',
  return: '/api/po/returns',
  sales_order: '/api/so/orders',
  shipment: '/api/so/shipments',
  sales_return: '/api/so/returns',
  transfer: '/api/inv/transfers',
  check: '/api/inv/checks',
  manufacture: '/api/ma/orders',
  expense: '/api/fin/expenses',
};

function formatTime(value: string | null): string {
  if (!value) return '—';
  return value.slice(0, 16).replace('T', ' ');
}

export function ApprovalPanel({
  docType,
  docId,
  status,
  steps,
  currentStep,
  approvalLevel,
  rejectReason,
  canWrite,
  canApprove,
  onChanged,
}: {
  docType: 'requisition' | 'order' | 'receipt' | 'return' | 'sales_order' | 'shipment' | 'sales_return' | 'transfer' | 'check' | 'manufacture' | 'expense';
  docId: string;
  status: string;
  steps: ApprovalStep[];
  currentStep: number;
  approvalLevel: number | null;
  rejectReason: string | null;
  canWrite: boolean;
  canApprove: boolean;
  onChanged: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [acting, setActing] = useState(false);
  // 信用超限强制通过（仅销售订单提交时可能触发 CREDIT.EXCEEDED）
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditMessage, setCreditMessage] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const base = `${API_BASE[docType]}/${docId}`;

  async function act(action: 'submit' | 'approve' | 'reject', body?: object) {
    setActing(true);
    try {
      await apiFetch(`${base}/${action}`, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      toast.success(action === 'submit' ? '已提交审批' : action === 'approve' ? '已通过' : '已驳回');
      setRejectOpen(false);
      setCreditOpen(false);
      setReason('');
      setCreditReason('');
      onChanged();
    } catch (error) {
      if (action === 'submit' && error instanceof ApiClientError && error.code === 'CREDIT.EXCEEDED') {
        setCreditMessage(error.message);
        setCreditOpen(true);
      } else {
        toast.error(error instanceof ApiClientError ? error.message : '操作失败');
      }
    } finally {
      setActing(false);
      setSubmitting(false);
    }
  }

  const showPanel = status === 'pending' || status === 'approved' || status === 'rejected' || (steps?.length ?? 0) > 0;
  if (!showPanel && !(canWrite && (status === 'draft' || status === 'rejected'))) return null;

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-stone-800">
          审批流程
          {approvalLevel ? <span className="ml-2 text-xs font-normal text-stone-500">（{approvalLevel} 级审批）</span> : null}
        </h2>
        <div className="flex flex-wrap gap-2">
          {canWrite && (status === 'draft' || status === 'rejected') ? (
            <Button
              size="sm"
              disabled={submitting}
              onClick={() => {
                setSubmitting(true);
                void act('submit');
              }}
            >
              <Send className="mr-1 h-4 w-4" />
              提交审批
            </Button>
          ) : null}
          {canApprove && status === 'pending' ? (
            <>
              <Button size="sm" disabled={acting} onClick={() => void act('approve')}>
                <CheckCircle2 className="mr-1 h-4 w-4" />
                审批通过
              </Button>
              <Button variant="outline" size="sm" disabled={acting} onClick={() => setRejectOpen(true)}>
                <XCircle className="mr-1 h-4 w-4" />
                驳回
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {status === 'rejected' && rejectReason ? (
        <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">驳回原因：{rejectReason}</p>
      ) : null}

      {steps && steps.length > 0 ? (
        <ol className="mt-3 space-y-2">
          {steps.map((step) => {
            const isCurrent = status === 'pending' && step.step_no === currentStep;
            return (
              <li
                key={step.step_no}
                className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs ${
                  isCurrent ? 'border-amber-300 bg-amber-50' : 'border-stone-200 bg-stone-50'
                }`}
              >
                <span className="font-medium text-stone-700">
                  第 {step.step_no} 步 · {step.approver_role_label}
                </span>
                <span
                  className={
                    step.status === 'approved'
                      ? 'text-green-700'
                      : step.status === 'rejected'
                        ? 'text-red-700'
                        : isCurrent
                          ? 'text-amber-700'
                          : 'text-stone-500'
                  }
                >
                  {step.status === 'approved' ? '已通过' : step.status === 'rejected' ? '已驳回' : isCurrent ? '审批中' : '待处理'}
                </span>
                {step.approver_name ? <span className="text-stone-500">{step.approver_name}</span> : null}
                {step.acted_at ? <span className="tabular-nums text-stone-400">{formatTime(step.acted_at)}</span> : null}
                {step.comment ? <span className="w-full text-stone-500">意见：{step.comment}</span> : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>驳回单据</DialogTitle>
            <DialogDescription>驳回后单据退回草稿/已驳回状态，可修改后重新提交。</DialogDescription>
          </DialogHeader>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="请填写驳回原因（必填）" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={acting || !reason.trim()}
              onClick={() => void act('reject', { reason: reason.trim() })}
            >
              确认驳回
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 信用超限强制通过（服务端已按权限裁决，无权限者会收到 403） */}
      <Dialog open={creditOpen} onOpenChange={setCreditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>客户信用额度超限</DialogTitle>
            <DialogDescription>{creditMessage}。如需继续提交，请填写强制通过原因（将写入审计日志）。</DialogDescription>
          </DialogHeader>
          <Input
            value={creditReason}
            onChange={(e) => setCreditReason(e.target.value)}
            placeholder="强制通过原因（必填）"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={acting || !creditReason.trim()}
              onClick={() => void act('submit', { force: true, reason: creditReason.trim() })}
            >
              强制通过并提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
