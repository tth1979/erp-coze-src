'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { Customer } from '@/lib/types';
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

interface CustomerFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = 新增；否则为编辑 */
  initial: Customer | null;
  onSaved: () => void;
}

const EMPTY = {
  code: '',
  name: '',
  contact: '',
  phone: '',
  email: '',
  address: '',
  level: 'normal',
  tax_no: '',
  status: 'active',
  credit_limit: '',
  credit_days: '',
  remark: '',
};

export function CustomerFormDialog({ open, onOpenChange, initial, onSaved }: CustomerFormDialogProps) {
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setForm({
        code: initial.code,
        name: initial.name,
        contact: initial.contact ?? '',
        phone: initial.phone ?? '',
        email: initial.email ?? '',
        address: initial.address ?? '',
        level: initial.level,
        tax_no: initial.tax_no ?? '',
        status: initial.status,
        credit_limit: initial.credit_limit ? String(initial.credit_limit) : '',
        credit_days: initial.credit_days ? String(initial.credit_days) : '',
        remark: initial.remark ?? '',
      });
    } else {
      setForm(EMPTY);
    }
  }, [open, initial]);

  function set(field: keyof typeof EMPTY) {
    return (value: string) => setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const creditLimit = form.credit_limit.trim() === '' ? 0 : Number(form.credit_limit);
      const creditDays = form.credit_days.trim() === '' ? 0 : Number(form.credit_days);
      if (!Number.isFinite(creditLimit) || creditLimit < 0) {
        toast.error('信用额度须为不小于 0 的数字');
        setSaving(false);
        return;
      }
      if (!Number.isInteger(creditDays) || creditDays < 0) {
        toast.error('信用账期须为不小于 0 的整数');
        setSaving(false);
        return;
      }
      const body = JSON.stringify({ ...form, credit_limit: creditLimit, credit_days: creditDays });
      if (initial) {
        await apiFetch(`/api/md/customers/${initial.id}`, { method: 'PUT', body });
        toast.success('客户已更新');
      } else {
        await apiFetch('/api/md/customers', { method: 'POST', body });
        toast.success('客户已创建');
      }
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{initial ? '编辑客户' : '新增客户'}</DialogTitle>
          <DialogDescription>客户编码在系统内唯一，保存后可用于业务单据引用。</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="c-code">客户编码 *</Label>
              <Input id="c-code" value={form.code} onChange={(e) => set('code')(e.target.value)} required maxLength={32} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-name">客户名称 *</Label>
              <Input id="c-name" value={form.name} onChange={(e) => set('name')(e.target.value)} required maxLength={128} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-contact">联系人</Label>
              <Input id="c-contact" value={form.contact} onChange={(e) => set('contact')(e.target.value)} maxLength={64} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-phone">联系电话</Label>
              <Input id="c-phone" value={form.phone} onChange={(e) => set('phone')(e.target.value)} maxLength={32} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-email">邮箱</Label>
              <Input id="c-email" type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} maxLength={128} />
            </div>
            <div className="space-y-2">
              <Label>客户等级</Label>
              <Select value={form.level} onValueChange={set('level')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">普通客户</SelectItem>
                  <SelectItem value="vip">VIP 客户</SelectItem>
                  <SelectItem value="strategic">战略客户</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-tax">税号</Label>
              <Input id="c-tax" value={form.tax_no} onChange={(e) => set('tax_no')(e.target.value)} maxLength={64} />
            </div>
            <div className="space-y-2">
              <Label>状态</Label>
              <Select value={form.status} onValueChange={set('status')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">启用</SelectItem>
                  <SelectItem value="disabled">停用</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-credit-limit">信用额度（元）</Label>
              <Input
                id="c-credit-limit"
                type="number"
                min={0}
                step="0.01"
                value={form.credit_limit}
                onChange={(e) => set('credit_limit')(e.target.value)}
                placeholder="0 = 不启用信用管控"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="c-credit-days">信用账期（天）</Label>
              <Input
                id="c-credit-days"
                type="number"
                min={0}
                step={1}
                value={form.credit_days}
                onChange={(e) => set('credit_days')(e.target.value)}
                placeholder="0 = 不计算逾期"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-address">地址</Label>
            <Input id="c-address" value={form.address} onChange={(e) => set('address')(e.target.value)} maxLength={256} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-remark">备注</Label>
            <Textarea id="c-remark" value={form.remark} onChange={(e) => set('remark')(e.target.value)} rows={3} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
