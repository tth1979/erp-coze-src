/**
 * 批次查询（inv_batches）
 * - 批次 = 采购入库时以「来源单号」为批号自动建立；FIFO 出库按建批时间扣减
 * - 对账口径：initial_quantity（累计入库）vs remaining_quantity（现存），差额即已出/已冲
 * - 支持 商品名/编码/批号 关键字、仓库、仅看有结余 过滤
 */
import { escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface BatchRow {
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  product_id: string;
  product_name: string;
  sku_code: string | null;
  unit: string | null;
  batch_no: string;
  unit_cost: string;
  initial_quantity: string;
  remaining_quantity: string;
  production_date: string | null;
  expiry_date: string | null;
  source_ref: string | null;
  created_at: string;
}

interface BatchListQuery extends ListQuery {
  warehouse_id?: string;
  /** '1' = 仅看 remaining_quantity > 0 */
  in_stock?: string;
}

export async function listBatches(query: BatchListQuery): Promise<PagedResult<BatchRow>> {
  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;

  const kw = escapeOrKeyword(query.keyword);
  // 关键字先试着匹配商品；批号过滤在下方 or 组合
  let productIds: string[] | null = null;
  if (kw) {
    const { data, error } = await getSupabaseClient()
      .from('md_products')
      .select('id')
      .or(`name.ilike.%${kw}%,sku_code.ilike.%${kw}%`);
    if (error) throwDbError(error, '匹配商品');
    productIds = (data ?? []).map((row) => row.id as string);
  }

  let req = getSupabaseClient()
    .from('inv_batches')
    .select(
      `
      id,
      warehouse_id,
      product_id,
      batch_no,
      unit_cost,
      initial_quantity,
      remaining_quantity,
      production_date,
      expiry_date,
      source_ref,
      created_at,
      warehouse:inv_warehouses!inner ( name ),
      product:md_products!inner ( name, sku_code, unit )
    `,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);

  if (query.warehouse_id) req = req.eq('warehouse_id', query.warehouse_id);
  if (query.in_stock === '1') req = req.gt('remaining_quantity', 0);
  if (kw) {
    if (productIds && productIds.length > 0) {
      req = req.or(`product_id.in.(${productIds.join(',')}),batch_no.ilike.%${kw}%`);
    } else {
      req = req.ilike('batch_no', `%${kw}%`);
    }
  }

  const { data, error, count } = await req;
  if (error) throwDbError(error, '查询批次');

  const items: BatchRow[] = (data ?? []).map((row) => {
    const product = (row.product ?? {}) as { name?: string; sku_code?: string | null; unit?: string | null };
    const warehouse = (row.warehouse ?? {}) as { name?: string };
    return {
      id: row.id as string,
      warehouse_id: row.warehouse_id as string,
      warehouse_name: warehouse.name ?? '—',
      product_id: row.product_id as string,
      product_name: product.name ?? '（已删除商品）',
      sku_code: product.sku_code ?? null,
      unit: product.unit ?? null,
      batch_no: row.batch_no as string,
      unit_cost: String(row.unit_cost),
      initial_quantity: String(row.initial_quantity),
      remaining_quantity: String(row.remaining_quantity),
      production_date: (row.production_date as string | null) ?? null,
      expiry_date: (row.expiry_date as string | null) ?? null,
      source_ref: (row.source_ref as string | null) ?? null,
      created_at: row.created_at as string,
    };
  });

  return { items, total: count ?? 0, page: query.page, page_size: query.pageSize };
}
