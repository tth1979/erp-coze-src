/**
 * 库存查询服务（inv_*，只读）
 * - 库存余额：每个商品一行，LEFT JOIN 商品主数据
 * - 流水台账：只追加，按时间倒序，支持类型筛选与商品名/单号模糊
 *
 * 实现说明：
 * PostgREST 的 .or() 不支持嵌入表列名前缀，故商品名/编码模糊查询采用
 * 「先查匹配的 product_id，再 in 过滤」两步法。
 * inv_stock_movements.created_by 当前无数据库 FK，操作人姓名同样两步补全。
 */
import { escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface StockRow {
  product_id: string;
  product_name: string;
  sku_code: string | null;
  spec: string | null;
  unit: string | null;
  quantity: string;
  /** 移动加权平均成本（采购 V2 起随入库更新） */
  avg_cost: string;
  /** 库存货值 = Σ 各次入库成本 − 出库成本 */
  total_cost: string;
  updated_at: string;
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

/** 库存余额分页（按更新时间倒序） */
export async function listStock(query: ListQuery): Promise<PagedResult<StockRow>> {
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
      product_id,
      quantity,
      avg_cost,
      total_cost,
      updated_at,
      product:md_products!inner (
        name,
        sku_code,
        spec,
        unit
      )
    `,
      { count: 'exact' },
    )
    .order('updated_at', { ascending: false })
    .range(from, to);

  if (productIds) req = req.in('product_id', productIds);

  const { data, error, count } = await req;
  if (error) throwDbError(error, '查询库存余额');

  const items: StockRow[] = (data ?? []).map((row) => {
    const product = (row.product ?? {}) as {
      name?: string;
      sku_code?: string | null;
      spec?: string | null;
      unit?: string | null;
    };
    return {
      product_id: row.product_id as string,
      product_name: product.name ?? '（已删除商品）',
      sku_code: product.sku_code ?? null,
      spec: product.spec ?? null,
      unit: product.unit ?? null,
      quantity: String(row.quantity),
      avg_cost: String(row.avg_cost ?? 0),
      total_cost: String(row.total_cost ?? 0),
      updated_at: row.updated_at as string,
    };
  });

  return { items, total: count ?? 0, page: query.page, page_size: query.pageSize };
}

export interface MovementRow {
  id: string;
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

/** 流水分页（时间倒序） */
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
    .from('inv_stock_movements')
    .select(
      `
      id,
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
      product:md_products!inner ( name, sku_code, unit )
    `,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, to);

  if (query.type) req = req.eq('type', query.type);
  if (kw) {
    if (productIds && productIds.length > 0) {
      req = req.or(`product_id.in.(${productIds.join(',')}),ref_no.ilike.%${kw}%`);
    } else {
      req = req.ilike('ref_no', `%${kw}%`);
    }
  }

  const { data, error, count } = await req;
  if (error) throwDbError(error, '查询库存流水');

  const creatorMap = await mapCreatorNames((data ?? []).map((row) => row.created_by as string | null));

  const items: MovementRow[] = (data ?? []).map((row) => {
    const product = (row.product ?? {}) as {
      name?: string;
      sku_code?: string | null;
      unit?: string | null;
    };
    const createdBy = (row.created_by as string | null) ?? null;
    return {
      id: row.id as string,
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
