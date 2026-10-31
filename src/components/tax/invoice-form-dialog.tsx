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

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function InvoiceFormDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [invoiceNo, setInvoiceNo] = useState('');
  const [invoiceCode, setInvoiceCode] = useState('');
  const [invoiceType, setInvoiceType] = useState('special');
  const [direction, setDirection] = useState('input');
  const [invoiceDate, setInvoiceDate] = useState(todayStr());
  const [amountExTax, setAmountExTax] = useState('');
  const [rate, setRate] = useState('13');
  const [taxAmount, setTaxAmount] = useState('');
  const [relatedBill, setRelatedBill] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setInvoiceNo('');
      setInvoiceCode('');
      setInvoiceType('special');
      setDirection('input');
      setInvoiceDate(todayStr());
      setAmountExTax('');
      setRate('13');
      setTaxAmount('');
      setRelatedBill('');
      setCounterparty('');
      setRemark('');
    }
  }, [open]);

  const exclNum = Number(amountExTax) || 0;
  const rateNum = Number(rate) || 0;
  const autoTax = round2((exclNum * rateNum) / 100);
  const taxNum = taxAmount.trim() === '' ? autoTax : Number(taxAmount) || 0;
  const total = round2(exclNum + taxNum);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!invoiceNo.trim()) {
      toast.error('请填写发票号');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/tax/invoices', {
        method: 'POST',
        body: JSON.stringify({
          invoice_no: invoiceNo.trim(),
          invoice_code: invoiceCode.trim() || null,
          invoice_type: invoiceType,
          direction,
          invoice_date: invoiceDate,
          amount_ex_tax: exclNum,
          tax_amount: taxNum,
          rate: rateNum,
          related_bill: relatedBill.trim() || null,
          supplier_name: direction === 'input' ? counterparty.trim() || null : null,
          customer_name: direction === 'output' ? counterparty.trim() || null : null,
          remark: remark.trim() || null,
        }),
      });
      toast.success('发票已录入');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error('录入失败', { description: err instanceof ApiClientError ? err.message : (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>录入发票</DialogTitle>
          <DialogDescription>进项/销项发票登记，价税合计由不含税额与税额自动计算</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="inv-no">发票号 *</Label>
              <Input id="inv-no" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="如 00123456" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-code">发票代码</Label>
              <Input id="inv-code" value={invoiceCode} onChange={(e) => setInvoiceCode(e.target.value)} placeholder="选填" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>方向 *</Label>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="input">进项</SelectItem>
                  <SelectItem value="output">销项</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>发票类型</Label>
              <Select value={invoiceType} onValueChange={setInvoiceType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="special">增值税专用发票</SelectItem>
                  <SelectItem value="normal">增值税普通发票</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="inv-date">开票日期 *</Label>
              <Input id="inv-date" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-bill">关联单号</Label>
              <Input id="inv-bill" value={relatedBill} onChange={(e) => setRelatedBill(e.target.value)} placeholder="采购/销售单号" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label htmlFor="inv-excl">不含税额 *</Label>
              <Input id="inv-excl" type="number" step="0.01" value={amountExTax} onChange={(e) => setAmountExTax(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-rate">税率(%)</Label>
              <Input id="inv-rate" type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="inv-tax">税额</Label>
              <Input id="inv-tax" type="number" step="0.01" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} placeholder={`自动 ${autoTax.toFixed(2)}`} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="inv-cp">{direction === 'input' ? '供应商' : '客户'}</Label>
            <Input id="inv-cp" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} placeholder="选填" />
          </div>
          <div className="rounded-md bg-stone-50 px-3 py-2 text-sm">
            价税合计：<span className="font-bold tabular-nums text-stone-900">¥{total.toFixed(2)}</span>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
