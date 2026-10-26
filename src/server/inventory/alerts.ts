/**
 * 库存预警（安全库存）
 * - 口径：md_products.safety_stock > 0 的商品，跨仓合计现有量 ≤ 阈值 → 预警
 * - SDK-only 约束：内存聚合（先取全部安全库存>0 的商品，再按 product_id 汇总 inv_stock）
 */
import { throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface AlertRow {
  product_id: string;
  product_name: string;
  sku_code: string | null;
  spec: string | null;
  unit: string | null;
  safety_stock: string;
  /** 跨仓合计现有量 */
  total_quantity: string;
  /** 缺口 = safety_stock − total_quantity */
  shortage: string;
}

export async function listAlerts(query: ListQuery): Promise<PagedResult<AlertRow>> {
  const supabase = getSupabaseClient();

  let prodReq = supabase
    .from('md_products')
    .select('id, name, sku_code, spec, unit, safety_stock')
    .gt('safety_stock', 0)
    .order('name', { ascending: true });
  const kw = query.keyword?.trim();
  if (kw) prodReq = prodReq.or(`name.ilike.%${kw}%,sku_code.ilike.%${kw}%`);
  const { data: products, error: pErr } = await prodReq;
  if (pErr) throwDbError(pErr, '查询安全库存商品');

  const list = (products ?? []) as Array<{
    id: string;
    name: string;
    sku_code: string | null;
    spec: string | null;
    unit: string | null;
    safety_stock: string | number;
  }>;
  if (list.length === 0) {
    return { items: [], total: 0, page: query.page, page_size: query.pageSize };
  }

  const ids = list.map((p) => p.id);
  const { data: stockRows, error: sErr } = await supabase
    .from('inv_stock')
    .select('product_id, quantity')
    .in('product_id', ids);
  if (sErr) throwDbError(sErr, '汇总库存');

  const totals = new Map<string, number>();
  for (const row of stockRows ?? []) {
    const pid = row.product_id as string;
    totals.set(pid, (totals.get(pid) ?? 0) + Number(row.quantity ?? 0));
  }

  // 合计现有量 ≤ 阈值 → 命中预警；缺货严重度（缺口）倒序
  const alerts: AlertRow[] = list
    .map((p) => {
      const total = totals.get(p.id) ?? 0;
      const safety = Number(p.safety_stock);
      return {
        product_id: p.id,
        product_name: p.name,
        sku_code: p.sku_code,
        spec: p.spec,
        unit: p.unit,
        safety_stock: String(p.safety_stock),
        total_quantity: String(total),
        shortage: String(safety - total),
      };
    })
    .filter((row) => Number(row.total_quantity) <= Number(row.safety_stock))
    .sort((a, b) => Number(b.shortage) - Number(a.shortage));

  const from = (query.page - 1) * query.pageSize;
  return {
    items: alerts.slice(from, from + query.pageSize),
    total: alerts.length,
    page: query.page,
    page_size: query.pageSize,
  };
}

/** 预警条数（仪表盘用） */
export async function countAlerts(): Promise<number> {
  const result = await listAlerts({ page: 1, pageSize: 1, keyword: '' });
  return result.total;
}
