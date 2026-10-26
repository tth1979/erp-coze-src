/**
 * 库存查询服务（inv_* 库存 V2 多仓库版）
 * - 库存余额：仓库 × 商品一行，含 现有量/冻结量/可用量/在途量/加权成本
 * - 台账：inv_stock_ledger 只追加，按时间倒序，支持类型/仓库筛选与商品名/单号模糊
 * - 冻结量调整：走 inv_adjust_frozen 数据库函数（行锁校验 0 ≤ frozen ≤ quantity）
 *
 * 实现说明：
 * PostgREST 的 .or() 不支持嵌入表列名前缀，故商品名/编码模糊查询采用
 * 「先查匹配的 product_id，再 in 过滤」两步法。
 * inv_stock_ledger.created_by 当前无数据库 FK，操作人姓名同样两步补全。
 */
import { escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { throwInventoryRpcError } from '@/server/inventory/shared';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface StockRow {
  warehouse_id: string;
  warehouse_name: string;
  warehouse_code: string;
  product_id: string;
  product_name: string;
  sku_code: string | null;
  spec: string | null;
  unit: string | null;
  /** 安全库存阈值（商品主数据；跨仓合计口径预警用） */
  safety_stock: string;
  /** 现有量（实物在库） */
  quantity: string;
  /** 冻结量（不可用） */
  frozen_quantity: string;
  /** 可用量 = 现有量 − 冻结量 */
  available_quantity: string;
  /** 在途量（调拨已审未收货） */
  in_transit: string;
  /** 移动加权平均成本 */
  avg_cost: string;
  /** 库存货值 = Σ 各次入库成本 − 出库成本 */
  total_cost: string;
  updated_at: string;
}

export interface StockListQuery extends ListQuery {
  warehouse_id?: string;
}

/** 按名称/编码模糊查匹配商品 ID（无关键字时返回 null 表示不过滤） */
async function matchProductIds(keyword: string): Promise<string[] | null> {
  const kw = escapeOrKeyword(keyword);
  if (!kw) return null;
  const { data, error } = await getSupabaseClient()
    .from('md_products')
    .select('id')
    .or(`name.ilike.%${kw}%,sku_code.ilike.%${kw}%`);
  if (error) throwDbError(error, '匹配商品');
  return (data ?? []).map((row) => row.id as string);
}

/** 库存余额分页（按更新时间倒序；warehouse_id 可选过滤） */
export async function listStock(query: StockListQuery): Promise<PagedResult<StockRow>> {
  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;

  const productIds = await matchProductIds(query.keyword);
  // 有关键字但无匹配商品 → 直接返回空页，避免 .in([]) 语义歧义
  if (productIds && productIds.length === 0) {
    return { items: [], total: 0, page: query.page, page_size: query.pageSize };
  }

  let req = getSupabaseClient()
    .from('inv_stock')
    .select(
      `
      warehouse_id,
      product_id,
      quantity,
      in_transit,
      frozen_quantity,
      avg_cost,
      total_cost,
      updated_at,
      warehouse:inv_warehouses!inner ( code, name ),
      product:md_products!inner ( name, sku_code, spec, unit, safety_stock )
    `,
      { count: 'exact' },
    )
    .order('updated_at', { ascending: false })
    .range(from, to);

  if (productIds) req = req.in('product_id', productIds);
  if (query.warehouse_id) req = req.eq('warehouse_id', query.warehouse_id);

  const { data, error, count } = await req;
  if (error) throwDbError(error, '查询库存余额');

  const items: StockRow[] = (data ?? []).map((row) => {
    const product = (row.product ?? {}) as {
      name?: string;
      sku_code?: string | null;
      spec?: string | null;
      unit?: string | null;
      safety_stock?: string | number;
    };
    const warehouse = (row.warehouse ?? {}) as { code?: string; name?: string };
    const quantity = Number(row.quantity ?? 0);
    const frozen = Number(row.frozen_quantity ?? 0);
    return {
      warehouse_id: row.warehouse_id as string,
      warehouse_name: warehouse.name ?? '—',
      warehouse_code: warehouse.code ?? '—',
      product_id: row.product_id as string,
      product_name: product.name ?? '（已删除商品）',
      sku_code: product.sku_code ?? null,
      spec: product.spec ?? null,
      unit: product.unit ?? null,
      safety_stock: String(product.safety_stock ?? 0),
      quantity: String(row.quantity),
      frozen_quantity: String(row.frozen_quantity ?? 0),
      available_quantity: String(quantity - frozen),
      in_transit: String(row.in_transit ?? 0),
      avg_cost: String(row.avg_cost ?? 0),
      total_cost: String(row.total_cost ?? 0),
      updated_at: row.updated_at as string,
    };
  });

  return { items, total: count ?? 0, page: query.page, page_size: query.pageSize };
}

/** 冻结量调整（正=冻结，负=解冻）；走数据库函数行锁校验 */
export async function adjustFrozen(input: {
  product_id: string;
  warehouse_id: string;
  delta: number;
}, userId: string): Promise<{ frozen_quantity: number }> {
  const { data, error } = await getSupabaseClient().rpc('inv_adjust_frozen', {
    p_product_id: input.product_id,
    p_warehouse_id: input.warehouse_id,
    p_delta: input.delta,
    p_user_id: userId,
  });
  if (error) throwInventoryRpcError(error, '调整冻结量');
  return { frozen_quantity: Number(data) };
}

export interface MovementRow {
  id: string;
  warehouse_id: string;
  warehouse_name: string;
  product_id: string;
  product_name: string;
  sku_code: string | null;
  unit: string | null;
  type: string;
  quantity: string;
  balance: string;
  source: string;
  ref_no: string | null;
  remark: string | null;
  /** 本次出入库的单价/成本快照（入库=实际单价，出库=加权均价） */
  unit_cost: string | null;
  created_by_name: string | null;
  created_at: string;
}

interface MovementListQuery extends ListQuery {
  type?: string;
  warehouse_id?: string;
}

/** 批量补全操作人姓名（created_by 无 FK，不能用嵌入） */
async function mapCreatorNames(userIds: (string | null)[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return new Map();
  const { data, error } = await getSupabaseClient()
    .from('sys_users')
    .select('id, username, display_name')
    .in('id', ids);
  if (error) throwDbError(error, '查询操作人');
  const map = new Map<string, string>();
  for (const row of data ?? []) {
    map.set(row.id as string, (row.display_name as string) || (row.username as string));
  }
  return map;
}

/** 台账分页（时间倒序；type/warehouse_id 可选过滤） */
export async function listMovements(query: MovementListQuery): Promise<PagedResult<MovementRow>> {
  const from = (query.page - 1) * query.pageSize;
  const to = from + query.pageSize - 1;

  // 关键字可能命中商品（名/编码）或关联单号，二者取并集
  const kw = escapeOrKeyword(query.keyword);
  let productIds: string[] | null = null;
  if (kw) {
    productIds = await matchProductIds(query.keyword);
    if (productIds && productIds.length === 0) productIds = [];
  }

  let req = getSupabaseClient()
    .from('inv_stock_ledger')
    .select(
      `
      id,
      warehouse_id,
      product_id,
      type,
      quantity,
      balance,
      source,
      ref_no,
      remark,
      unit_cost,
      created_by,
      created_at,
      warehouse:inv_warehouses!inner ( name ),
      product:md_products!inner ( name, sku_code, unit )
    `,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);

  if (query.type) req = req.eq('type', query.type);
  if (query.warehouse_id) req = req.eq('warehouse_id', query.warehouse_id);
  if (kw) {
    if (productIds && productIds.length > 0) {
      req = req.or(`product_id.in.(${productIds.join(',')}),ref_no.ilike.%${kw}%`);
    } else {
      req = req.ilike('ref_no', `%${kw}%`);
    }
  }

  const { data, error, count } = await req;
  if (error) throwDbError(error, '查询库存台账');

  const creatorMap = await mapCreatorNames((data ?? []).map((row) => row.created_by as string | null));

  const items: MovementRow[] = (data ?? []).map((row) => {
    const product = (row.product ?? {}) as {
      name?: string;
      sku_code?: string | null;
      unit?: string | null;
    };
    const warehouse = (row.warehouse ?? {}) as { name?: string };
    const createdBy = (row.created_by as string | null) ?? null;
    return {
      id: row.id as string,
      warehouse_id: row.warehouse_id as string,
      warehouse_name: warehouse.name ?? '—',
      product_id: row.product_id as string,
      product_name: product.name ?? '（已删除商品）',
      sku_code: product.sku_code ?? null,
      unit: product.unit ?? null,
      type: row.type as string,
      quantity: String(row.quantity),
      balance: String(row.balance),
      source: row.source as string,
      ref_no: (row.ref_no as string | null) ?? null,
      remark: (row.remark as string | null) ?? null,
      unit_cost: row.unit_cost === null || row.unit_cost === undefined ? null : String(row.unit_cost),
      created_by_name: createdBy ? (creatorMap.get(createdBy) ?? null) : null,
      created_at: row.created_at as string,
    };
  });

  return { items, total: count ?? 0, page: query.page, page_size: query.pageSize };
}
