'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api-client';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { FinBillRow } from '@/lib/types';

export const METHOD_LABELS: Record<string, string> = {
  cash: '现金',
  bank: '银行转账',
  wechat: '微信',
  alipay: '支付宝',
  other: '其他',
};

interface PaymentFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** receipt=收款（客户） | payment=付款（供应商） */
  kind: 'receipt' | 'payment';
  /** 往来单位 */
  partner: { id: string; code: string; name: string } | null;
  /** 当前欠款（用于预填与提示） */
  outstanding: number;
  /** 按单核销：勾选的待核销单（可选）；提供后金额不可超出所选单余额合计，并按单拆分登记 */
  bills?: FinBillRow[];
  onSaved: () => void;
}

function today(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function PaymentFormDialog({
  open,
  onOpenChange,
  kind,
  partner,
  outstanding,
  bills,
  onSaved,
}: PaymentFormDialogProps) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank');
  const [paidAt, setPaidAt] = useState('');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  const isReceipt = kind === 'receipt';
  // 按单核销时总额为所选单余额合计，金额不可超出
  const available = bills && bills.length > 0 ? bills.reduce((s, b) => s + b.outstanding, 0) : outstanding;

  useEffect(() => {
    if (!open) return;
    setAmount(available > 0 ? available.toFixed(2) : '');
    setMethod('bank');
    setPaidAt(today());
    setRemark('');
  }, [open, available]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!partner) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('请输入正确的金额');
      return;
    }
    if (value > available + 0.001) {
      toast.error(`金额不可超出可核销余额 ¥${available.toFixed(2)}`);
      return;
    }
    setSaving(true);
    try {
      const base = {
        method,
        paid_at: paidAt || undefined,
        remark: remark.trim() || undefined,
      };
      // 按单核销：勾选多单时逐单拆分登记，保证每单不超额
      const targets = bills && bills.length > 0 ? bills.sort((a, b) => b.outstanding - a.outstanding) : null;
      let remaining = value;
      if (targets) {
        const plans = targets.map((b) => {
          const take = Math.min(b.outstanding, remaining);
          remaining = Math.round((remaining - take) * 100) / 100;
          return {
            order_id: b.order_id,
            amount: Math.round(take * 100) / 100,
          };
        });
        if (remaining > 0.001 && plans.length > 0) {
          plans[plans.length - 1].amount = Math.round((plans[plans.length - 1].amount + remaining) * 100) / 100;
        }
        for (const p of plans.filter((x) => x.amount > 0)) {
          await apiFetch(isReceipt ? '/api/fin/receipts' : '/api/fin/payments', {
            method: 'POST',
            body: JSON.stringify({
              ...(isReceipt ? { customer_id: partner.id } : { supplier_id: partner.id }),
              ...base,
              amount: p.amount,
              order_id: p.order_id,
            }),
          });
        }
      } else {
        await apiFetch(isReceipt ? '/api/fin/receipts' : '/api/fin/payments', {
          method: 'POST',
          body: JSON.stringify({
            ...(isReceipt ? { customer_id: partner.id } : { supplier_id: partner.id }),
            ...base,
            amount: value,
          }),
        });
      }
      toast.success(isReceipt ? '收款已登记' : '付款已登记');
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isReceipt ? '登记收款' : '登记付款'}</DialogTitle>
          <DialogDescription>
            {partner ? (
              <>
                {isReceipt ? '客户' : '供应商'}：{partner.name}（{partner.code}），可核销{' '}
                <span className="font-medium text-red-600 tabular-nums">
                  ¥{available.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                </span>
                {bills && bills.length > 0 ? `（按 ${bills.length} 单核销）` : '（当前欠款）'}
              </>
            ) : (
              '请选择往来单位'
            )}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="fin-amount">金额（元）*</Label>
              <Input
                id="fin-amount"
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
                className="tabular-nums"
              />
            </div>
            <div className="space-y-2">
              <Label>{isReceipt ? '收款方式' : '付款方式'} *</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(METHOD_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="fin-paid-at">{isReceipt ? '收款日期' : '付款日期'} *</Label>
              <Input id="fin-paid-at" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="fin-remark">备注</Label>
            <Textarea
              id="fin-remark"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="如：部分回款 / 尾款结清…"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            <Button type="submit" disabled={saving || !partner}>
              {saving ? '保存中…' : isReceipt ? '确认收款' : '确认付款'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
