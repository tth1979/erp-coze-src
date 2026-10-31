'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { formatMoney } from '@/components/finance/balance-list';
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

export interface FixedAssetDetail {
  id: string;
  asset_no: string;
  name: string;
  category: string | null;
  spec: string | null;
  original_value: number;
  useful_life: number;
  salvage_value: number;
  acquisition_date: string;
  related_subject: string;
  status: string;
  accrued: number;
  net_value: number;
  months_accrued: number;
  monthly_depreciation: number;
}

interface SubjectOption {
  subject_code: string;
  subject_name: string;
}

const CATEGORY_OPTIONS = ['房屋建筑', '机器设备', '运输设备', '办公设备', '电子设备', '其他'];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function FixedAssetFormDialog({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: (detail: FixedAssetDetail) => void;
}) {
  const [assetNo, setAssetNo] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('机器设备');
  const [spec, setSpec] = useState('');
  const [originalValue, setOriginalValue] = useState('');
  const [usefulLife, setUsefulLife] = useState('60');
  const [salvageValue, setSalvageValue] = useState('0');
  const [acquisitionDate, setAcquisitionDate] = useState(todayStr());
  const [relatedSubject, setRelatedSubject] = useState('6601');
  const [remark, setRemark] = useState('');
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const ov = Number(originalValue) || 0;
  const sv = Number(salvageValue) || 0;
  const life = Number(usefulLife) || 0;
  const monthly = life > 0 && ov > sv ? Math.round(((ov - sv) / life) * 100) / 100 : 0;

  useEffect(() => {
    if (!open) return;
    apiFetch<{ items: SubjectOption[] }>('/api/fin/subjects?category=6&status=active&pageSize=100')
      .then((res) => setSubjects(res.items ?? []))
      .catch(() => setSubjects([]));
  }, [open]);

  useEffect(() => {
    if (open) {
      setAssetNo('');
      setName('');
      setCategory('机器设备');
      setSpec('');
      setOriginalValue('');
      setUsefulLife('60');
      setSalvageValue('0');
      setAcquisitionDate(todayStr());
      setRelatedSubject('6601');
      setRemark('');
    }
  }, [open]);

  async function handleSubmit() {
    if (!name.trim()) { toast.error('请填写资产名称'); return; }
    if (!(ov > 0)) { toast.error('原值必须大于 0'); return; }
    if (!(life > 0)) { toast.error('使用年限(月)必须大于 0'); return; }
    if (sv < 0 || sv >= ov) { toast.error('残值须 ≥ 0 且小于原值'); return; }
    setSubmitting(true);
    try {
      const detail = await apiFetch<FixedAssetDetail>('/api/fin/fixed-assets', {
        method: 'POST',
        body: JSON.stringify({
          asset_no: assetNo.trim() || undefined,
          name: name.trim(),
          category,
          spec: spec.trim() || undefined,
          original_value: ov,
          useful_life: life,
          salvage_value: sv,
          acquisition_date: acquisitionDate,
          related_subject: relatedSubject,
          remark: remark.trim() || undefined,
        }),
      });
      toast.success(`资产卡片已建立：${detail.asset_no}`);
      onSaved(detail);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>新建固定资产卡片</DialogTitle>
          <DialogDescription>直线法折旧，入账次月起按月计提；残值须小于原值</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1">
            <Label>资产名称 *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：叉车 / 货车 / 切割机" />
          </div>
          <div className="space-y-1">
            <Label>资产编码（留空自动生成）</Label>
            <Input value={assetNo} onChange={(e) => setAssetNo(e.target.value)} placeholder="FA…" />
          </div>
          <div className="space-y-1">
            <Label>类别</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORY_OPTIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>规格型号</Label>
            <Input value={spec} onChange={(e) => setSpec(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>入账日期 *</Label>
            <Input type="date" value={acquisitionDate} onChange={(e) => setAcquisitionDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>原值（元）*</Label>
            <Input type="number" min="0" step="0.01" value={originalValue} onChange={(e) => setOriginalValue(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>残值（元）</Label>
            <Input type="number" min="0" step="0.01" value={salvageValue} onChange={(e) => setSalvageValue(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>使用年限（月）*</Label>
            <Input type="number" min="1" step="1" value={usefulLife} onChange={(e) => setUsefulLife(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>折旧费用科目</Label>
            <Select value={relatedSubject} onValueChange={setRelatedSubject}>
              <SelectTrigger><SelectValue placeholder="选择费用科目" /></SelectTrigger>
              <SelectContent>
                {subjects.map((s) => (
                  <SelectItem key={s.subject_code} value={s.subject_code}>
                    {s.subject_code} {s.subject_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2 rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-600">
            月折旧额（直线法）：<span className="font-semibold tabular-nums text-stone-900">¥{formatMoney(monthly)}</span>
            <span className="ml-2 text-xs text-stone-400">=（原值 − 残值）/ 使用年限</span>
          </div>
          <div className="col-span-2 space-y-1">
            <Label>备注</Label>
            <Textarea rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting}>{submitting ? '保存中…' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
