/**
 * 经营统计-采购报表
 *
 * 口径：仅统计状态为 received（已入库）的采购订单 total_amount。
 * 维度：按供应商（supplier）或月份（month）分桶，可加日期范围过滤。
 * SDK-only 内存聚合。
 */
import { throwDbError } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { inRange, monthKey, parseRange, round2, toNum, type DateRange, type ReportGroupBy } from './shared';

export interface PurchaseReportRow {
  key: string;
  name: string;
  amount: number;
  order_count: number;
}

export async function buildPurchaseReport(
  groupBy: ReportGroupBy,
  searchParams: URLSearchParams,
): Promise<PurchaseReportRow[]> {
  const range: DateRange = parseRange(searchParams);
  const supabase = getSupabaseClient();

  const { data: rows, error } = await supabase
    .from('po_purchase_orders')
    .select('order_date, total_amount, supplier_id')
    .eq('status', 'received');
  if (error) throwDbError(error, '读取采购数据');

  const list = (rows ?? []) as Array<{ order_date: string; total_amount: string; supplier_id: string }>;
  const filtered = list.filter((r) => inRange(r.order_date, range));

  if (groupBy === 'month') {
    const map = new Map<string, { amount: number; count: number }>();
    for (const r of filtered) {
      const k = monthKey(r.order_date) || 'unknown';
      const acc = map.get(k) ?? { amount: 0, count: 0 };
      acc.amount += toNum(r.total_amount);
      acc.count += 1;
      map.set(k, acc);
    }
    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, v]) => ({ key, name: key, amount: round2(v.amount), order_count: v.count }));
  }

  // 按供应商：先聚合并取供应商名
  const bySupplier = new Map<string, { amount: number; count: number }>();
  for (const r of filtered) {
    const acc = bySupplier.get(r.supplier_id) ?? { amount: 0, count: 0 };
    acc.amount += toNum(r.total_amount);
    acc.count += 1;
    bySupplier.set(r.supplier_id, acc);
  }
  const ids = [...bySupplier.keys()];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: supRows, error: sErr } = await supabase.from('md_suppliers').select('id, name');
    if (sErr) throwDbError(sErr, '读取供应商');
    for (const s of supRows ?? []) names.set(s.id as string, (s.name as string) ?? '');
  }
  return [...bySupplier.entries()]
    .map(([id, v]) => ({
      key: id,
      name: names.get(id) ?? '未知供应商',
      amount: round2(v.amount),
      order_count: v.count,
    }))
    .sort((a, b) => b.amount - a.amount);
}