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
  /** 色号编码（'' = 默认色/未分色）；预警按 商品×色号 维度合计 */
  color_code: string;
  color_name: string | null;
  /** 跨仓合计现有量（该色号） */
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
    .select('product_id, color_code, quantity')
    .in('product_id', ids);
  if (sErr) throwDbError(sErr, '汇总库存');

  // 按 商品×色号 聚合（色号维度账实一致）
  const totals = new Map<string, number>();
  for (const row of stockRows ?? []) {
    const key = `${row.product_id as string}|${(row.color_code as string) ?? ''}`;
    totals.set(key, (totals.get(key) ?? 0) + Number(row.quantity ?? 0));
  }
  // 色号名称补全
  const { data: colorRows } = await supabase
    .from('md_product_colors')
    .select('product_id, color_code, color_name')
    .in('product_id', ids);
  const colorNames = new Map<string, string>();
  for (const c of colorRows ?? []) {
    colorNames.set(`${c.product_id as string}|${c.color_code as string}`, c.color_name as string);
  }

  // 每个商品展开为 商品×色号 行（无库存行时以 '' 色号 0 量兜底，保证断货也能预警）
  const expanded: Array<{ p: (typeof list)[number]; colorCode: string; total: number }> = [];
  for (const p of list) {
    const colorCodes = new Set<string>();
    for (const key of totals.keys()) {
      if (key.startsWith(`${p.id}|`)) colorCodes.add(key.slice(p.id.length + 1));
    }
    if (colorCodes.size === 0) {
      expanded.push({ p, colorCode: '', total: 0 });
    } else {
      for (const code of colorCodes) {
        expanded.push({ p, colorCode: code, total: totals.get(`${p.id}|${code}`) ?? 0 });
      }
    }
  }

  // 合计现有量 ≤ 阈值 → 命中预警；缺货严重度（缺口）倒序
  const alerts: AlertRow[] = expanded
    .map(({ p, colorCode, total }) => {
      const safety = Number(p.safety_stock);
      return {
        product_id: p.id,
        product_name: p.name,
        sku_code: p.sku_code,
        spec: p.spec,
        unit: p.unit,
        safety_stock: String(p.safety_stock),
        color_code: colorCode,
        color_name: colorCode ? (colorNames.get(`${p.id}|${colorCode}`) ?? null) : null,
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
