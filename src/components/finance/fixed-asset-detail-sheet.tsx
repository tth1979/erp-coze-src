'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import { formatMoney } from '@/components/finance/balance-list';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';

export interface DepreciationRecord {
  id: string;
  period: string;
  amount: number;
  voucher_no: string | null;
  created_at: string;
}

export interface FixedAssetFull {
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
  disposal_date: string | null;
  disposal_type: string | null;
  disposal_income: number;
  disposal_reason: string | null;
  disposal_voucher_no: string | null;
  remark: string | null;
  records: DepreciationRecord[];
}

const STATUS_LABEL: Record<string, string> = {
  in_use: '在用',
  fully_depreciated: '已折旧完',
  disposed: '已处置',
};

export function statusBadge(status: string) {
  const label = STATUS_LABEL[status] ?? status;
  if (status === 'in_use') {
    return <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">{label}</Badge>;
  }
  if (status === 'fully_depreciated') {
    return <Badge variant="outline" className="border-sky-200 bg-sky-50 text-sky-700">{label}</Badge>;
  }
  return <Badge variant="outline" className="border-stone-200 bg-stone-50 text-stone-500">{label}</Badge>;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function FixedAssetDetailSheet({
  assetId,
  open,
  onOpenChange,
  canWrite,
  onChanged,
}: {
  assetId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<FixedAssetFull | null>(null);
  const [loading, setLoading] = useState(false);
  const [disposeOpen, setDisposeOpen] = useState(false);
  const [disposeDate, setDisposeDate] = useState(todayStr());
  const [disposeType, setDisposeType] = useState<'sell' | 'scrap'>('sell');
  const [disposeIncome, setDisposeIncome] = useState('0');
  const [disposeReason, setDisposeReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    try {
      setDetail(await apiFetch<FixedAssetFull>(`/api/fin/fixed-assets/${id}`));
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && assetId) void load(assetId);
    if (!open) { setDetail(null); setDisposeOpen(false); }
  }, [open, assetId, load]);

  async function handleDispose() {
    if (!detail) return;
    const income = Number(disposeIncome) || 0;
    if (income < 0) { toast.error('处置收入不能为负'); return; }
    setSubmitting(true);
    try {
      await apiFetch(`/api/fin/fixed-assets/${detail.id}/dispose`, {
        method: 'POST',
        body: JSON.stringify({
          disposal_date: disposeDate,
          disposal_type: disposeType,
          disposal_income: income,
          disposal_reason: disposeReason.trim() || undefined,
        }),
      });
      toast.success('已处置并生成处置凭证');
      setDisposeOpen(false);
      await load(detail.id);
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '处置失败');
    } finally {
      setSubmitting(false);
    }
  }

  const income = Number(disposeIncome) || 0;
  const previewNet = detail?.net_value ?? 0;
  const previewGain = Math.round((income - previewNet) * 100) / 100;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>固定资产卡片</SheetTitle>
          <SheetDescription>{detail ? `${detail.asset_no} · ${detail.name}` : '加载中…'}</SheetDescription>
        </SheetHeader>
        {loading || !detail ? (
          <p className="mt-6 text-sm text-stone-500">加载中…</p>
        ) : (
          <div className="mt-4 space-y-5">
            <div className="flex items-center gap-2">
              {statusBadge(detail.status)}
              <span className="text-xs text-stone-400">直线法 · {detail.useful_life} 月</span>
            </div>

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-stone-200 bg-stone-50/60 p-3.5 text-sm">
              <div><dt className="text-xs text-stone-500">类别 / 规格</dt><dd className="mt-0.5 text-stone-900">{detail.category ?? '—'} {detail.spec ? `· ${detail.spec}` : ''}</dd></div>
              <div><dt className="text-xs text-stone-500">入账日期</dt><dd className="mt-0.5 text-stone-900">{detail.acquisition_date}</dd></div>
              <div><dt className="text-xs text-stone-500">原值</dt><dd className="mt-0.5 tabular-nums font-semibold text-stone-900">¥{formatMoney(detail.original_value)}</dd></div>
              <div><dt className="text-xs text-stone-500">残值</dt><dd className="mt-0.5 tabular-nums text-stone-900">¥{formatMoney(detail.salvage_value)}</dd></div>
              <div><dt className="text-xs text-stone-500">月折旧额</dt><dd className="mt-0.5 tabular-nums text-stone-900">¥{formatMoney(detail.monthly_depreciation)}</dd></div>
              <div><dt className="text-xs text-stone-500">折旧费用科目</dt><dd className="mt-0.5 font-mono text-stone-900">{detail.related_subject}</dd></div>
              <div><dt className="text-xs text-stone-500">累计折旧（{detail.months_accrued} 期）</dt><dd className="mt-0.5 tabular-nums text-amber-700">¥{formatMoney(detail.accrued)}</dd></div>
              <div><dt className="text-xs text-stone-500">净值</dt><dd className="mt-0.5 tabular-nums font-semibold text-emerald-700">¥{formatMoney(detail.net_value)}</dd></div>
            </dl>

            {/* 折旧进度条 */}
            <div>
              <div className="mb-1 flex justify-between text-xs text-stone-500">
                <span>折旧进度（应提 {formatMoney(detail.original_value - detail.salvage_value)}）</span>
                <span>{detail.useful_life > 0 ? Math.min(Math.round((detail.months_accrued / detail.useful_life) * 100), 100) : 0}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-stone-100">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all"
                  style={{ width: `${detail.useful_life > 0 ? Math.min((detail.months_accrued / detail.useful_life) * 100, 100) : 0}%` }}
                />
              </div>
            </div>

            {/* 处置信息 */}
            {detail.status === 'disposed' && (
              <div className="rounded-lg border border-stone-200 bg-white p-3.5 text-sm">
                <p className="mb-1.5 text-xs font-medium text-stone-500">处置信息</p>
                <p className="text-stone-800">
                  {detail.disposal_date} · {detail.disposal_type === 'sell' ? '出售' : '报废'} · 收入 ¥{formatMoney(detail.disposal_income)}
                </p>
                {detail.disposal_reason && <p className="mt-1 text-xs text-stone-500">{detail.disposal_reason}</p>}
                {detail.disposal_voucher_no && <p className="mt-1 font-mono text-xs text-stone-500">凭证 {detail.disposal_voucher_no}</p>}
              </div>
            )}

            {/* 处置操作 */}
            {canWrite && detail.status !== 'disposed' && (
              <div className="rounded-lg border border-stone-200 bg-white p-3.5">
                {!disposeOpen ? (
                  <Button variant="outline" size="sm" onClick={() => setDisposeOpen(true)}>处置（出售 / 报废）</Button>
                ) : (
                  <div className="space-y-2.5">
                    <p className="text-xs font-medium text-stone-500">资产处置（生成处置凭证，不可撤销）</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">处置日期</Label>
                        <Input type="date" value={disposeDate} onChange={(e) => setDisposeDate(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">方式</Label>
                        <Select value={disposeType} onValueChange={(v) => setDisposeType(v as 'sell' | 'scrap')}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sell">出售</SelectItem>
                            <SelectItem value="scrap">报废</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">处置收入（元）</Label>
                        <Input type="number" min="0" step="0.01" value={disposeIncome} onChange={(e) => setDisposeIncome(e.target.value)} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">处置原因</Label>
                      <Textarea rows={2} value={disposeReason} onChange={(e) => setDisposeReason(e.target.value)} />
                    </div>
                    <p className={`text-xs ${previewGain >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      按当前净值 ¥{formatMoney(previewNet)} 测算：{previewGain >= 0 ? `处置收益 ¥${formatMoney(previewGain)}（贷 6301）` : `处置损失 ¥${formatMoney(-previewGain)}（借 6711）`}
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleDispose} disabled={submitting}>{submitting ? '提交中…' : '确认处置'}</Button>
                      <Button size="sm" variant="outline" onClick={() => setDisposeOpen(false)}>取消</Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 折旧历史 */}
            <div>
              <p className="mb-2 text-xs font-medium text-stone-500">折旧历史（{detail.records.length} 期）</p>
              {detail.records.length === 0 ? (
                <p className="text-sm text-stone-400">尚未计提折旧</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-stone-200">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-stone-50 text-left text-xs text-stone-500">
                        <th className="px-3 py-2 font-medium">期间</th>
                        <th className="px-3 py-2 text-right font-medium">折旧额</th>
                        <th className="px-3 py-2 font-medium">凭证号</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.records.map((r) => (
                        <tr key={r.id} className="border-t border-stone-100">
                          <td className="px-3 py-2 font-mono text-xs">{r.period}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatMoney(r.amount)}</td>
                          <td className="px-3 py-2 font-mono text-xs text-stone-500">{r.voucher_no ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
