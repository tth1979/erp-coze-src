'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { Supplier } from '@/lib/types';
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

interface SupplierFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: Supplier | null;
  onSaved: () => void;
}

const EMPTY = {
  code: '',
  name: '',
  contact: '',
  phone: '',
  email: '',
  address: '',
  tax_no: '',
  settlement: '',
  status: 'active',
  remark: '',
};

export function SupplierFormDialog({ open, onOpenChange, initial, onSaved }: SupplierFormDialogProps) {
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
        tax_no: initial.tax_no ?? '',
        settlement: initial.settlement ?? '',
        status: initial.status,
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
      const body = JSON.stringify(form);
      if (initial) {
        await apiFetch(`/api/md/suppliers/${initial.id}`, { method: 'PUT', body });
        toast.success('供应商已更新');
      } else {
        await apiFetch('/api/md/suppliers', { method: 'POST', body });
        toast.success('供应商已创建');
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
          <DialogTitle>{initial ? '编辑供应商' : '新增供应商'}</DialogTitle>
          <DialogDescription>供应商编码在系统内唯一，保存后可用于采购业务引用。</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="s-code">供应商编码 *</Label>
              <Input id="s-code" value={form.code} onChange={(e) => set('code')(e.target.value)} required maxLength={32} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-name">供应商名称 *</Label>
              <Input id="s-name" value={form.name} onChange={(e) => set('name')(e.target.value)} required maxLength={128} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-contact">联系人</Label>
              <Input id="s-contact" value={form.contact} onChange={(e) => set('contact')(e.target.value)} maxLength={64} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-phone">联系电话</Label>
              <Input id="s-phone" value={form.phone} onChange={(e) => set('phone')(e.target.value)} maxLength={32} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-email">邮箱</Label>
              <Input id="s-email" type="email" value={form.email} onChange={(e) => set('email')(e.target.value)} maxLength={128} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-settlement">结算方式</Label>
              <Input
                id="s-settlement"
                placeholder="如：月结 30 天 / 款到发货"
                value={form.settlement}
                onChange={(e) => set('settlement')(e.target.value)}
                maxLength={64}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-tax">税号</Label>
              <Input id="s-tax" value={form.tax_no} onChange={(e) => set('tax_no')(e.target.value)} maxLength={64} />
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-address">地址</Label>
            <Input id="s-address" value={form.address} onChange={(e) => set('address')(e.target.value)} maxLength={256} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-remark">备注</Label>
            <Textarea id="s-remark" value={form.remark} onChange={(e) => set('remark')(e.target.value)} rows={3} />
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
