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
  onSaved: () => void;
}

function today(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function PaymentFormDialog({ open, onOpenChange, kind, partner, outstanding, onSaved }: PaymentFormDialogProps) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank');
  const [paidAt, setPaidAt] = useState('');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  const isReceipt = kind === 'receipt';

  useEffect(() => {
    if (!open) return;
    setAmount(outstanding > 0 ? outstanding.toFixed(2) : '');
    setMethod('bank');
    setPaidAt(today());
    setRemark('');
  }, [open, outstanding]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!partner) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('请输入正确的金额');
      return;
    }
    setSaving(true);
    try {
      const body = JSON.stringify({
        ...(isReceipt ? { customer_id: partner.id } : { supplier_id: partner.id }),
        amount: value,
        method,
        paid_at: paidAt || undefined,
        remark: remark.trim() || undefined,
      });
      await apiFetch(isReceipt ? '/api/fin/receipts' : '/api/fin/payments', { method: 'POST', body });
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
                {isReceipt ? '客户' : '供应商'}：{partner.name}（{partner.code}），当前欠款{' '}
                <span className="font-medium text-red-600 tabular-nums">
                  ¥{outstanding.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                </span>
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
