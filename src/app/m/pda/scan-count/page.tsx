'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ClipboardCheck, ScanBarcode, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/components/auth/auth-provider';
import { Button } from '@/components/ui/button';
import { apiFetch, ApiClientError } from '@/lib/api-client';
import type { InvCheck, InvCheckItem } from '@/lib/types';
import { cn } from '@/lib/utils';

interface Warehouse {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

const ACTIVE = (s: string) => s === 'draft' || s === 'pending';

/** PDA 扫码盘点录入：复用盘点单(IC)——扫条码定位→录实盘→保存→提交(→审批) */
export default function ScanCountPage() {
  const { can } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [whId, setWhId] = useState('');
  const [check, setCheck] = useState<InvCheck | null>(null);
  const [resume, setResume] = useState<InvCheck[]>([]);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [barcode, setBarcode] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const loadWarehouses = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: Warehouse[] }>('/api/inv/warehouses');
      const rows = res.items ?? [];
      setWarehouses(rows);
      if (rows.length && !whId) setWhId(rows.find((w) => w.is_active)?.id ?? rows[0].id);
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '仓库加载失败');
    }
  }, [whId]);

  const loadResume = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: InvCheck[] }>('/api/inv/checks?pageSize=20');
      setResume(res.items.filter((c) => ACTIVE(c.status)));
    } catch {
      /* 只读兜底 */
    }
  }, []);

  useEffect(() => {
    void loadWarehouses();
    void loadResume();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCheck = useCallback((c: InvCheck) => {
    setCheck(c);
    setCounts(
      Object.fromEntries((c.items ?? []).map((it) => [it.id, String(it.counted_quantity ?? it.book_quantity ?? 0)])),
    );
  }, []);

  const createCheck = async () => {
    if (!whId) {
      toast.warning('请先选择仓库');
      return;
    }
    setBusy(true);
    try {
      const created = await apiFetch<InvCheck>('/api/inv/checks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ warehouse_id: whId }),
      });
      openCheck(created);
      toast.success(`盘点单 ${created.check_no} 已建立`);
      inputRef.current?.focus();
      void loadResume();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '建单失败');
    } finally {
      setBusy(false);
    }
  };

  const saveCounts = async () => {
    if (!check) return;
    const items = (check.items ?? [])
      .filter((it) => counts[it.id] !== undefined)
      .map((it) => ({ id: it.id, counted_quantity: Number(counts[it.id] ?? it.book_quantity) }));
    setBusy(true);
    try {
      const updated = await apiFetch<InvCheck>(`/api/inv/checks/${check.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      openCheck(updated);
      toast.success('实盘进度已保存');
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };

  const submitCheck = async () => {
    if (!check) return;
    setBusy(true);
    try {
      await apiFetch(`/api/inv/checks/${check.id}/submit`, { method: 'POST' });
      toast.success('已提交审核');
      const detail = await apiFetch<InvCheck>(`/api/inv/checks/${check.id}`);
      openCheck(detail);
      void loadResume();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '提交失败');
    } finally {
      setBusy(false);
    }
  };

  const approveCheck = async () => {
    if (!check) return;
    setBusy(true);
    try {
      await apiFetch(`/api/inv/checks/${check.id}/approve`, { method: 'POST' });
      toast.success('审核通过，差异已过账');
      const detail = await apiFetch<InvCheck>(`/api/inv/checks/${check.id}`);
      openCheck(detail);
      void loadResume();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : '审核失败');
    } finally {
      setBusy(false);
    }
  };

  const onScan = () => {
    const code = barcode.trim();
    if (!code) return;
    const items = check?.items ?? [];
    const hit = items.find(
      (it) => it.sku_code?.toLowerCase() === code.toLowerCase() || String(it.sku_code ?? '').includes(code),
    );
    if (hit) {
      itemRefs.current[hit.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setBarcode('');
      return;
    }
    toast.info('未找到匹配的盘点行，请核对条码');
  };

  const items = check?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-stone-800">扫码盘点</h1>
        <span className="text-xs text-stone-400">盘点单 IC · 手持端</span>
      </div>

      {/* 建单 */}
      {!check && (
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <label className="text-xs text-stone-500">盘点仓库</label>
          <select
            value={whId}
            onChange={(e) => setWhId(e.target.value)}
            className="mt-1 w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-base"
          >
            <option value="">请选择仓库</option>
            {warehouses
              .filter((w) => w.is_active)
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}（{w.code}）
                </option>
              ))}
          </select>
          <Button className="mt-3 w-full py-3 text-base" onClick={createCheck} disabled={busy}>
            <ClipboardCheck className="mr-2 h-5 w-5" /> 建立盘点单（快照账面）
          </Button>
        </div>
      )}

      {/* 进行中的盘点单（可续盘） */}
      {resume.length > 0 && (
        <div className="rounded-2xl border border-stone-200 bg-white p-4">
          <p className="mb-2 text-xs font-medium text-stone-500">进行中的单据</p>
          <div className="space-y-2">
            {resume.map((c) => (
              <button
                type="button"
                key={c.id}
                onClick={() => openCheck(c)}
                className="flex w-full items-center justify-between rounded-xl border border-stone-200 px-3 py-2.5 text-left"
              >
                <span className="text-sm font-medium text-stone-700">{c.check_no}</span>
                <span className="text-xs text-stone-400">
                  {c.warehouse_name} · {c.status === 'draft' ? '草稿' : '待审'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 盘点明细 */}
      {check && (
        <>
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-stone-200 bg-white p-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-stone-800">{check.check_no}</p>
              <p className="text-xs text-stone-400">
                {check.warehouse_name} · {check.status === 'draft' ? '草稿' : check.status === 'pending' ? '待审' : check.status === 'approved' ? '已过账' : check.status}
              </p>
            </div>
            <span className="text-xs text-stone-500">{items.length} 行</span>
            <button type="button" onClick={() => setCheck(null)} className="text-xs text-stone-400 underline">
              返回
            </button>
          </div>

          {/* 扫码定位 */}
          <div className="flex gap-2 rounded-2xl border border-stone-200 bg-white p-3">
            <input
              ref={inputRef}
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onScan();
              }}
              placeholder="扫码 / 手输条码后回车定位"
              className="min-w-0 flex-1 rounded-xl border border-stone-300 px-3 py-3 text-base"
            />
            <Button className="px-4" onClick={onScan}>
              <ScanBarcode className="h-5 w-5" />
            </Button>
          </div>

          {/* 明细行 */}
          <div className="space-y-2">
            {items.length === 0 && (
              <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-6 text-center text-sm text-stone-400">
                该仓库暂无实物库存，无需盘点
              </div>
            )}
            {items.map((it: InvCheckItem, idx) => (
              <div
                key={it.id}
                ref={(el) => {
                  itemRefs.current[it.id] = el;
                }}
                className={cn(
                  'rounded-2xl border bg-white p-3 shadow-sm',
                  idx % 2 === 0 ? 'border-stone-200' : 'border-stone-200',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-stone-800">{it.product_name}</p>
                    <p className="truncate text-xs text-stone-400">{it.sku_code}</p>
                  </div>
                  <div className="text-right text-xs text-stone-500">
                    账面 <span className="font-semibold text-stone-700">{it.book_quantity}</span>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    value={counts[it.id] ?? String(it.book_quantity)}
                    onChange={(e) => setCounts((p) => ({ ...p, [it.id]: e.target.value }))}
                    onFocus={(e) => e.target.select()}
                    inputMode="decimal"
                    className="min-w-0 flex-1 rounded-xl border border-stone-300 px-3 py-2.5 text-base font-semibold text-stone-800"
                  />
                  <span
                    className={cn(
                      'shrink-0 rounded-lg px-2 py-1 text-xs font-semibold',
                      (Number(counts[it.id] ?? it.book_quantity) - it.book_quantity) > 0
                        ? 'bg-emerald-100 text-emerald-700'
                        : (Number(counts[it.id] ?? it.book_quantity) - it.book_quantity) < 0
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-stone-100 text-stone-500',
                    )}
                  >
                    {Number(counts[it.id] ?? it.book_quantity) - it.book_quantity > 0
                      ? `+${Number(counts[it.id] ?? it.book_quantity) - it.book_quantity}`
                      : Number(counts[it.id] ?? it.book_quantity) - it.book_quantity}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* 操作 */}
          {check.status === 'draft' && (
            <div className="fixed inset-x-0 bottom-14 z-10 border-t border-stone-200 bg-white p-3">
              <div className="mx-auto flex max-w-3xl gap-2">
                <Button variant="outline" className="flex-1 py-3 text-base" onClick={saveCounts} disabled={busy}>
                  <Save className="mr-1.5 h-4 w-4" /> 保存
                </Button>
                <Button className="flex-1 py-3 text-base" onClick={submitCheck} disabled={busy}>
                  提交审核
                </Button>
              </div>
            </div>
          )}
          {check.status === 'pending' && can('inv.approve') && (
            <div className="fixed inset-x-0 bottom-14 z-10 border-t border-stone-200 bg-white p-3">
              <div className="mx-auto flex max-w-3xl">
                <Button className="w-full py-3 text-base" onClick={approveCheck} disabled={busy}>
                  审核通过（差异过账）
                </Button>
              </div>
            </div>
          )}
          {check.status === 'approved' && (
            <p className="text-center text-sm text-emerald-600">已过账：盘盈/盘亏已计入库存台账</p>
          )}
        </>
      )}

      <p className="pt-1 text-center text-xs text-stone-300">
        数据与桌面端「库存 → 库存盘点」同源 ·{' '}
        <Link href="/inventory/checks" className="underline">
          前往桌面端
        </Link>
      </p>
    </div>
  );
}