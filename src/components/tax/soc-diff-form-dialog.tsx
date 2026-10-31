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

const currentPeriod = (): string => new Date().toISOString().slice(0, 7);
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function SocDiffFormDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [period, setPeriod] = useState(currentPeriod());
  const [diffType, setDiffType] = useState('temporary');
  const [item, setItem] = useState('');
  const [taxBase, setTaxBase] = useState('');
  const [accountingBase, setAccountingBase] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setPeriod(currentPeriod());
      setDiffType('temporary');
      setItem('');
      setTaxBase('');
      setAccountingBase('');
      setDescription('');
    }
  }, [open]);

  const diff = round2((Number(taxBase) || 0) - (Number(accountingBase) || 0));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!item.trim()) {
      toast.error('请填写差异项目');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/tax/soc-diff', {
        method: 'POST',
        body: JSON.stringify({
          period,
          diff_type: diffType,
          item: item.trim(),
          description: description.trim() || null,
          tax_base: Number(taxBase) || 0,
          accounting_base: Number(accountingBase) || 0,
        }),
      });
      toast.success('税会差异已登记');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast.error('登记失败', { description: err instanceof ApiClientError ? err.message : (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>登记税会差异</DialogTitle>
          <DialogDescription>时间性差异日常提示；永久性差异留待汇算清缴处理</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="sd-period">所属期间 *</Label>
              <Input id="sd-period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>差异类型 *</Label>
              <Select value={diffType} onValueChange={setDiffType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="temporary">时间性差异</SelectItem>
                  <SelectItem value="permanent">永久性差异</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sd-item">差异项目 *</Label>
            <Input id="sd-item" value={item} onChange={(e) => setItem(e.target.value)} placeholder="如 固定资产折旧差异" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="sd-tax">税法金额 *</Label>
              <Input id="sd-tax" type="number" step="0.01" value={taxBase} onChange={(e) => setTaxBase(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sd-acc">会计金额 *</Label>
              <Input id="sd-acc" type="number" step="0.01" value={accountingBase} onChange={(e) => setAccountingBase(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="rounded-md bg-stone-50 px-3 py-2 text-sm">
            差异额（税法−会计）：<span className={`font-bold tabular-nums ${diff >= 0 ? 'text-red-600' : 'text-green-700'}`}>¥{diff.toFixed(2)}</span>
          </div>
          <div className="space-y-1">
            <Label htmlFor="sd-desc">说明</Label>
            <Textarea id="sd-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="选填" />
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
