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

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const currentPeriod = (): string => new Date().toISOString().slice(0, 7);

export function PrepaidFormDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [period, setPeriod] = useState(currentPeriod());
  const [project, setProject] = useState('');
  const [region, setRegion] = useState('');
  const [prepaidAmount, setPrepaidAmount] = useState('');
  const [basedTax, setBasedTax] = useState('');
  const [prepaidDate, setPrepaidDate] = useState(todayStr());
  const [related, setRelated] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setPeriod(currentPeriod());
      setProject('');
      setRegion('');
      setPrepaidAmount('');
      setBasedTax('');
      setPrepaidDate(todayStr());
      setRelated('');
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!project.trim()) {
      toast.error('请填写工程项目');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/tax/prepaid', {
        method: 'POST',
        body: JSON.stringify({
          period,
          project: project.trim(),
          region: region.trim() || null,
          prepaid_amount: Number(prepaidAmount) || 0,
          based_tax: Number(basedTax) || 0,
          prepaid_date: prepaidDate,
          related: related.trim() || null,
        }),
      });
      toast.success('预缴已登记');
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
          <DialogTitle>登记异地预缴</DialogTitle>
          <DialogDescription>工程项目地预缴增值税，纳入申报底稿抵减应纳税额</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="pp-period">所属期间 *</Label>
              <Input id="pp-period" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pp-date">预缴日期 *</Label>
              <Input id="pp-date" type="date" value={prepaidDate} onChange={(e) => setPrepaidDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pp-project">工程项目 *</Label>
            <Input id="pp-project" value={project} onChange={(e) => setProject(e.target.value)} placeholder="如 XX 项目外墙工程" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pp-region">项目所在地</Label>
            <Input id="pp-region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="如 江苏南京" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="pp-amount">预缴税额 *</Label>
              <Input id="pp-amount" type="number" step="0.01" value={prepaidAmount} onChange={(e) => setPrepaidAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pp-base">计税依据</Label>
              <Input id="pp-base" type="number" step="0.01" value={basedTax} onChange={(e) => setBasedTax(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pp-related">关联单号/备注</Label>
            <Input id="pp-related" value={related} onChange={(e) => setRelated(e.target.value)} placeholder="选填" />
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
