'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
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

interface ClaimItemView {
  subject_code: string;
  subject_name: string;
  summary: string | null;
  amount: number;
  tax_rate: number;
  excl_amount: number;
  tax_amount: number;
}

export interface ExpenseClaimDetail {
  id: string;
  claim_no: string;
  status: string;
  items: ClaimItemView[];
}

interface SubjectOption {
  subject_code: string;
  subject_name: string;
}

interface ItemDraft {
  subject_code: string;
  summary: string;
  amount: string;
  tax_rate: string;
}

const PAY_ACCOUNT_OPTIONS = [
  { value: '2241', label: '其他应付款-员工（先挂账后付款）' },
  { value: '1002', label: '银行存款（直接付款）' },
];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function emptyItem(): ItemDraft {
  return { subject_code: '', summary: '', amount: '', tax_rate: '0' };
}

export function ExpenseFormDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (detail: ExpenseClaimDetail) => void;
}) {
  const [applicant, setApplicant] = useState('');
  const [dept, setDept] = useState('');
  const [claimDate, setClaimDate] = useState(todayStr());
  const [payee, setPayee] = useState('');
  const [payAccount, setPayAccount] = useState('2241');
  const [remark, setRemark] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([emptyItem()]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    // 载入末级损益类（费用）科目供选择
    apiFetch<{ items: { subject_code: string; subject_name: string }[] }>(
      '/api/fin/subjects?category=6&status=active&pageSize=100',
    )
      .then((data) => setSubjects(data.items.filter((s) => s.subject_code)))
      .catch(() => setSubjects([]));
  }, [open]);

  function reset() {
    setApplicant('');
    setDept('');
    setClaimDate(todayStr());
    setPayee('');
    setPayAccount('2241');
    setRemark('');
    setItems([emptyItem()]);
  }

  function patchItem(index: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  }

  const totalAmount = items.reduce((sum, it) => sum + (Number(it.amount) || 0), 0);

  async function submit() {
    if (!applicant.trim()) {
      toast.error('请填写报销人');
      return;
    }
    const payloadItems = items
      .filter((it) => it.subject_code && Number(it.amount) > 0)
      .map((it) => ({
        subject_code: it.subject_code,
        summary: it.summary.trim() || null,
        amount: Number(it.amount),
        tax_rate: Number(it.tax_rate) || 0,
      }));
    if (payloadItems.length === 0) {
      toast.error('请至少填写一条有效费用明细（科目 + 金额）');
      return;
    }
    setSaving(true);
    try {
      const detail = await apiFetch<ExpenseClaimDetail>('/api/fin/expenses', {
        method: 'POST',
        body: JSON.stringify({
          applicant: applicant.trim(),
          dept: dept.trim() || null,
          claim_date: claimDate,
          payee: payee.trim() || null,
          pay_account: payAccount,
          remark: remark.trim() || null,
          items: payloadItems,
        }),
      });
      toast.success('报销单已创建', { description: `单号 ${detail.claim_no}` });
      reset();
      onSaved(detail);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '创建失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>新建费用报销单</DialogTitle>
          <DialogDescription>金额为含税金额，系统按税率自动价税分离；审批通过后生成费用凭证</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="exp-applicant">报销人</Label>
            <Input id="exp-applicant" value={applicant} onChange={(e) => setApplicant(e.target.value)} placeholder="如 张三" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-dept">部门</Label>
            <Input id="exp-dept" value={dept} onChange={(e) => setDept(e.target.value)} placeholder="如 行政部" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-date">报销日期</Label>
            <Input id="exp-date" type="date" value={claimDate} onChange={(e) => setClaimDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="exp-payee">收款人</Label>
            <Input id="exp-payee" value={payee} onChange={(e) => setPayee(e.target.value)} placeholder="默认同报销人" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>贷方科目</Label>
            <Select value={payAccount} onValueChange={setPayAccount}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAY_ACCOUNT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>费用明细</Label>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setItems((prev) => [...prev, emptyItem()])}
              type="button"
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              添加明细
            </Button>
          </div>
          <div className="space-y-2">
            {items.map((it, index) => (
              <div key={index} className="grid grid-cols-2 gap-2 rounded-md border border-stone-200 p-2 sm:grid-cols-12">
                <div className="col-span-2 space-y-1 sm:col-span-4">
                  <Select
                    value={it.subject_code}
                    onValueChange={(v) => patchItem(index, { subject_code: v })}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue placeholder="费用科目" />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects.length === 0 && <SelectItem value="__none" disabled>暂无科目</SelectItem>}
                      {subjects.map((s) => (
                        <SelectItem key={s.subject_code} value={s.subject_code}>
                          {s.subject_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 sm:col-span-3">
                  <Input
                    className="h-8"
                    value={it.summary}
                    onChange={(e) => patchItem(index, { summary: e.target.value })}
                    placeholder="摘要"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    className="h-8"
                    type="number"
                    inputMode="decimal"
                    value={it.amount}
                    onChange={(e) => patchItem(index, { amount: e.target.value })}
                    placeholder="含税金额"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Input
                    className="h-8"
                    type="number"
                    inputMode="decimal"
                    value={it.tax_rate}
                    onChange={(e) => patchItem(index, { tax_rate: e.target.value })}
                    placeholder="税率%"
                  />
                </div>
                <div className="flex items-center justify-end sm:col-span-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-stone-400 hover:text-red-600"
                    disabled={items.length === 1}
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== index))}
                    aria-label="删除明细"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="exp-remark">备注</Label>
          <Textarea id="exp-remark" value={remark} onChange={(e) => setRemark(e.target.value)} rows={2} />
        </div>

        <DialogFooter className="items-center justify-between sm:justify-between">
          <span className="text-sm text-stone-600">
            合计（含税）：<span className="font-semibold tabular-nums text-stone-900">¥{totalAmount.toFixed(2)}</span>
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button disabled={saving} onClick={submit}>
              {saving ? '保存中…' : '创建'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
