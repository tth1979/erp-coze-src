import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { MdProduct } from '@/storage/database/shared/schema';
import { ApiError } from '@/server/http';
import {
  emptyToNull,
  escapeOrKeyword,
  throwDbError,
  type ListQuery,
  type PagedResult,
} from './helpers';

export interface ProductInput {
  sku_code: string;
  name: string;
  model?: string | null;
  spec?: string | null;
  unit?: string;
  barcode?: string | null;
  category?: string | null;
  brand?: string | null;
  color?: string | null;
  pieces_per_box?: number | null;
  area_per_box?: number | null;
  reference_purchase_price?: number | null;
  reference_sale_price?: number | null;
  status?: string;
  remark?: string | null;
}

const TABLE = 'md_products';
const SEARCH_FIELDS = ['name', 'sku_code', 'model', 'barcode', 'brand'];

function normalize(input: ProductInput) {
  return {
    sku_code: input.sku_code.trim(),
    name: input.name.trim(),
    model: emptyToNull(input.model),
    spec: emptyToNull(input.spec),
    unit: input.unit?.trim() || '片',
    barcode: emptyToNull(input.barcode),
    category: emptyToNull(input.category),
    brand: emptyToNull(input.brand),
    color: emptyToNull(input.color),
    pieces_per_box: input.pieces_per_box ?? null,
    area_per_box: input.area_per_box ?? null,
    reference_purchase_price: input.reference_purchase_price ?? null,
    reference_sale_price: input.reference_sale_price ?? null,
    status: input.status ?? 'active',
    remark: emptyToNull(input.remark),
  };
}

export async function listProducts(q: ListQuery): Promise<PagedResult<MdProduct>> {
  const client = getSupabaseClient();
  let query = client.from(TABLE).select('*', { count: 'exact' });
  const kw = escapeOrKeyword(q.keyword);
  if (kw) {
    query = query.or(SEARCH_FIELDS.map((f) => `${f}.ilike.%${kw}%`).join(','));
  }
  const from = (q.page - 1) * q.pageSize;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + q.pageSize - 1);
  if (error) throwDbError(error, '查询商品');
  return { items: (data ?? []) as MdProduct[], total: count ?? 0, page: q.page, page_size: q.pageSize };
}

export async function getProduct(id: string): Promise<MdProduct> {
  const client = getSupabaseClient();
  const { data, error } = await client.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询商品');
  if (!data) throw new ApiError(404, 'MD.NOT_FOUND', '商品不存在');
  return data as MdProduct;
}

export async function createProduct(input: ProductInput): Promise<MdProduct> {
  const client = getSupabaseClient();
  const { data, error } = await client.from(TABLE).insert(normalize(input)).select().single();
  if (error) throwDbError(error, '创建商品');
  return data as MdProduct;
}

export async function updateProduct(id: string, input: Partial<ProductInput>): Promise<MdProduct> {
  const client = getSupabaseClient();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const normalized = normalize({ sku_code: '', name: '', ...input } as ProductInput);
  for (const [key, value] of Object.entries(normalized)) {
    if (input[key as keyof ProductInput] !== undefined) patch[key] = value;
  }
  const { data, error } = await client.from(TABLE).update(patch).eq('id', id).select().maybeSingle();
  if (error) throwDbError(error, '更新商品');
  if (!data) throw new ApiError(404, 'MD.NOT_FOUND', '商品不存在');
  return data as MdProduct;
}

export async function deleteProduct(id: string): Promise<void> {
  const client = getSupabaseClient();
  const { data, error } = await client.from(TABLE).delete().eq('id', id).select('id');
  if (error) throwDbError(error, '删除商品');
  if (!data || data.length === 0) throw new ApiError(404, 'MD.NOT_FOUND', '商品不存在');
}
