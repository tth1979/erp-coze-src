/**
 * 经营统计-库存报表
 *
 * 口径：inv_stock 现有余额（quantity）与货值（quantity × avg_cost），跨仓/按品。
 * 维度：按仓库（warehouse）或商品（product）分桶。
 * SDK-only 内存聚合。
 */
import { throwDbError } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { parseRange, round2, toNum, type ReportGroupBy } from './shared';

export interface InventoryReportRow {
  key: string;
  name: string;
  quantity: number;
  value: number;
}

export async function buildInventoryReport(
  groupBy: ReportGroupBy,
  searchParams: URLSearchParams,
): Promise<InventoryReportRow[]> {
  void parseRange(searchParams);
  const supabase = getSupabaseClient();

  const { data: rows, error } = await supabase
    .from('inv_stock')
    .select('warehouse_id, product_id, quantity, avg_cost');
  if (error) throwDbError(error, '读取库存余额');

  const list = (rows ?? []) as Array<{
    warehouse_id: string;
    product_id: string;
    quantity: string;
    avg_cost: string;
  }>;

  const sum = new Map<string, { quantity: number; value: number }>();
  for (const r of list) {
    const key = groupBy === 'product' ? r.product_id : r.warehouse_id;
    const acc = sum.get(key) ?? { quantity: 0, value: 0 };
    const qty = toNum(r.quantity);
    acc.quantity += qty;
    acc.value += qty * toNum(r.avg_cost);
    sum.set(key, acc);
  }

  let names = new Map<string, string>();
  const ids = [...sum.keys()];
  if (ids.length) {
    const table = groupBy === 'product' ? 'md_products' : 'inv_warehouses';
    const { data: rows2, error: e2 } = await supabase.from(table).select('id, name');
    if (e2) throwDbError(e2, '读取名称');
    names = new Map((rows2 ?? []).map((r) => [r.id as string, (r.name as string) ?? '']));
  }

  return [...sum.entries()]
    .map(([key, v]) => ({ key, name: names.get(key) ?? '未知', quantity: round2(v.quantity), value: round2(v.value) }))
    .sort((a, b) => b.value - a.value);
}