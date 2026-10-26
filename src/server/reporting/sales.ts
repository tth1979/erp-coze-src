/**
 * 经营统计-销售报表
 *
 * 口径：
 * - customer / month：Σ(shipped 销售订单 total_amount) − Σ(approved 销售退货 total_amount)
 * - product：按销售订单明细行 amount 聚合（shipped 订单），关联商品名
 * SDK-only 内存聚合，日期范围过滤。
 */
import { throwDbError } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { inRange, monthKey, parseRange, round2, toNum, type DateRange, type ReportGroupBy } from './shared';

export interface SalesReportRow {
  key: string;
  name: string;
  amount: number;
  order_count: number;
}

export async function buildSalesReport(
  groupBy: ReportGroupBy,
  searchParams: URLSearchParams,
): Promise<SalesReportRow[]> {
  const range: DateRange = parseRange(searchParams);
  const supabase = getSupabaseClient();

  if (groupBy === 'product') {
    const { data: orders, error: oErr } = await supabase
      .from('so_sales_orders')
      .select('id, order_date')
      .eq('status', 'shipped');
    if (oErr) throwDbError(oErr, '读取销售订单');
    const orderIds = (orders ?? []).filter((o) => inRange(o.order_date as string, range)).map((o) => o.id);
    if (!orderIds.length) {
      return [];
    }
    const { data: items, error: iErr } = await supabase
      .from('so_sales_order_items')
      .select('product_id, amount')
      .in('order_id', orderIds as string[]);
    if (iErr) throwDbError(iErr, '读取销售明细');
    const byProduct = new Map<string, number>();
    for (const it of items ?? []) {
      byProduct.set(it.product_id as string, (byProduct.get(it.product_id as string) ?? 0) + toNum(it.amount));
    }
    const ids = [...byProduct.keys()];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: pRows, error: pErr } = await supabase.from('md_products').select('id, name, sku_code');
      if (pErr) throwDbError(pErr, '读取商品');
      for (const p of pRows ?? []) names.set(p.id as string, `${(p.name as string) ?? ''}${p.sku_code ? ` (${p.sku_code})` : ''}`);
    }
    return [...byProduct.entries()]
      .map(([id, v]) => ({ key: id, name: names.get(id) ?? '未知商品', amount: round2(v), order_count: 0 }))
      .sort((a, b) => b.amount - a.amount);
  }

  // customer / month：订单总额 − 退货总额
  const { data: orders, error: oErr2 } = await supabase
    .from('so_sales_orders')
    .select('id, order_date, total_amount, customer_id')
    .eq('status', 'shipped');
  if (oErr2) throwDbError(oErr2, '读取销售订单');
  const { data: returns, error: rErr } = await supabase
    .from('so_returns')
    .select('order_id, return_date, total_amount')
    .eq('status', 'approved');
  if (rErr) throwDbError(rErr, '读取销售退货');

  const returnByOrder = new Map<string, number>();
  for (const rt of returns ?? []) {
    const key = rt.order_id as string;
    if (inRange(rt.return_date as string, range)) {
      returnByOrder.set(key, (returnByOrder.get(key) ?? 0) + toNum(rt.total_amount));
    }
  }

  const sum = new Map<string, { amount: number; count: number; orderId: string }>();
  const ordered: Array<{ key: string; orderId: string; amount: number }> = [];
  for (const o of orders ?? []) {
    if (!inRange(o.order_date as string, range)) continue;
    let net = toNum(o.total_amount) - (returnByOrder.get(o.id as string) ?? 0);
    if (net < 0) net = 0;
    const key = groupBy === 'month' ? monthKey(o.order_date as string) : (o.customer_id as string);
    const bucket = key || 'unknown';
    const acc = sum.get(bucket) ?? { amount: 0, count: 0, orderId: '' };
    acc.amount += net;
    acc.count += 1;
    acc.orderId = o.id as string;
    sum.set(bucket, acc);
    ordered.push({ key: bucket, orderId: o.id as string, amount: net });
  }
  void ordered;

  let names = new Map<string, string>();
  if (groupBy === 'customer') {
    const ids = [...sum.keys()];
    if (ids.length) {
      const { data: cRows, error: cErr } = await supabase.from('md_customers').select('id, name');
      if (cErr) throwDbError(cErr, '读取客户');
      names = new Map((cRows ?? []).map((c) => [c.id as string, (c.name as string) ?? '']));
    }
  }
  return [...sum.entries()]
    .map(([key, v]) => ({
      key,
      name: groupBy === 'month' ? key : names.get(key) ?? '未知客户',
      amount: round2(v.amount),
      order_count: v.count,
    }))
    .sort((a, b) => (groupBy === 'month' ? (a.name < b.name ? -1 : 1) : b.amount - a.amount));
}