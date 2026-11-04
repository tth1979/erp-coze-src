/**
 * 商品色号档案（md_product_colors，0022）
 *
 * - 库存最小管理单元 = sku + color_code + batch_no + 仓库。
 * - 色号编码在商品内唯一（DB 唯一约束）；status=active 可选 / disabled 停用（不影响历史单据）。
 * - resolveItemColors：单据明细落库前统一校验并回填 color_name 快照；
 *   '' 空色号 = 默认色/未分色（存量兼容），不校验档案。
 */
import { z } from 'zod';
import { ApiError } from '@/server/http';
import { throwDbError } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const colorUpsertSchema = z.object({
  color_code: z
    .string()
    .min(1, '色号编码不能为空')
    .max(32, '色号编码不能超过 32 字')
    .regex(/^[A-Za-z0-9_-]+$/, '色号编码仅支持字母/数字/短横线/下划线'),
  color_name: z.string().min(1, '色号名称不能为空').max(64, '色号名称不能超过 64 字'),
  remark: z.string().max(200, '备注不能超过 200 字').optional(),
});
export type ColorUpsertInput = z.infer<typeof colorUpsertSchema>;

export interface ProductColorView {
  id: string;
  product_id: string;
  color_code: string;
  color_name: string;
  status: string;
  remark: string | null;
  /** 库存关联：该色号跨仓现有量合计 */
  stock_quantity: number;
  created_at: string;
  updated_at: string;
}

function serialize(row: Record<string, unknown>, stockQty: number): ProductColorView {
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    color_code: row.color_code as string,
    color_name: row.color_name as string,
    status: row.status as string,
    remark: (row.remark as string | null) ?? null,
    stock_quantity: stockQty,
    created_at: new Date(row.created_at as string).toISOString(),
    updated_at: new Date(row.updated_at as string).toISOString(),
  };
}

/** 多商品色号列表（供单据编辑页按商品联动渲染；无库存关联量，轻量） */
export async function listColors(productIds?: string[]): Promise<ProductColorView[]> {
  const supabase = getSupabaseClient();
  let q = supabase.from('md_product_colors').select('*').order('color_code', { ascending: true });
  if (productIds && productIds.length > 0) q = q.in('product_id', productIds);
  const { data, error } = await q;
  if (error) throwDbError(error, '查询色号档案');
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => serialize(r, 0));
}

/** 商品色号列表（含库存关联量） */
export async function listProductColors(productId: string): Promise<ProductColorView[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('md_product_colors')
    .select('*')
    .eq('product_id', productId)
    .order('color_code', { ascending: true });
  if (error) throwDbError(error, '查询色号档案');
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  // 库存关联：按色号汇总现有量（该商品全部仓）
  const { data: stocks, error: sErr } = await supabase
    .from('inv_stock')
    .select('color_code, quantity')
    .eq('product_id', productId);
  if (sErr) throwDbError(sErr, '汇总色号库存');
  const qtyMap = new Map<string, number>();
  for (const s of stocks ?? []) {
    const code = (s.color_code as string) ?? '';
    qtyMap.set(code, (qtyMap.get(code) ?? 0) + Number(s.quantity ?? 0));
  }
  return rows.map((r) => serialize(r, qtyMap.get(r.color_code as string) ?? 0));
}

/** 新增色号（编码商品内唯一 409） */
export async function createProductColor(productId: string, input: ColorUpsertInput): Promise<ProductColorView> {
  const supabase = getSupabaseClient();
  const { data: product } = await supabase.from('md_products').select('id').eq('id', productId).maybeSingle();
  if (!product) throw new ApiError(404, 'MD.NOT_FOUND', '商品不存在');

  const { data, error } = await supabase
    .from('md_product_colors')
    .insert({
      product_id: productId,
      color_code: input.color_code.trim(),
      color_name: input.color_name.trim(),
      remark: input.remark?.trim() || null,
      status: 'active',
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new ApiError(409, 'MD.COLOR_DUPLICATED', '该商品下色号编码已存在');
    throwDbError(error, '新增色号');
  }
  return serialize(data as Record<string, unknown>, 0);
}

/** 更新色号（名称/备注/启停；编码不可改） */
export async function updateProductColor(
  id: string,
  input: Partial<ColorUpsertInput> & { status?: string },
): Promise<ProductColorView> {
  const supabase = getSupabaseClient();
  const { data: existing, error: findErr } = await supabase
    .from('md_product_colors')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (findErr) throwDbError(findErr, '查询色号');
  if (!existing) throw new ApiError(404, 'MD.COLOR_NOT_FOUND', '色号不存在');

  if (input.status !== undefined && !['active', 'disabled'].includes(input.status)) {
    throw new ApiError(400, 'MD.COLOR_STATUS_INVALID', '色号状态仅支持 active/disabled');
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.color_name !== undefined) patch.color_name = input.color_name.trim();
  if (input.remark !== undefined) patch.remark = input.remark.trim() || null;
  if (input.status !== undefined) patch.status = input.status;

  const { data, error } = await supabase.from('md_product_colors').update(patch).eq('id', id).select('*').single();
  if (error) throwDbError(error, '更新色号');

  const { data: stocks } = await supabase
    .from('inv_stock')
    .select('quantity')
    .eq('product_id', (data as Record<string, unknown>).product_id as string)
    .eq('color_code', (data as Record<string, unknown>).color_code as string);
  const qty = (stocks ?? []).reduce((acc, s) => acc + Number(s.quantity ?? 0), 0);
  return serialize(data as Record<string, unknown>, qty);
}

/** 删除色号（有库存或有单据引用时禁删，可停用） */
export async function deleteProductColor(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: existing } = await supabase.from('md_product_colors').select('*').eq('id', id).maybeSingle();
  if (!existing) throw new ApiError(404, 'MD.COLOR_NOT_FOUND', '色号不存在');
  const row = existing as Record<string, unknown>;

  // 库存引用守卫：该商品该色号任一仓有量（现有/在途/冻结）则禁删
  const { data: stocks } = await supabase
    .from('inv_stock')
    .select('quantity, in_transit, frozen_quantity')
    .eq('product_id', row.product_id as string)
    .eq('color_code', row.color_code as string);
  const hasStock = (stocks ?? []).some(
    (s) => Number(s.quantity ?? 0) !== 0 || Number(s.in_transit ?? 0) !== 0 || Number(s.frozen_quantity ?? 0) !== 0,
  );
  if (hasStock) {
    throw new ApiError(400, 'MD.COLOR_HAS_STOCK', '该色号仍有库存，不能删除（可停用）');
  }
  const { error } = await supabase.from('md_product_colors').delete().eq('id', id);
  if (error) throwDbError(error, '删除色号');
}

/**
 * 单据明细色号解析与校验（采购/销售/调拨/加工共用）：
 * - color_code 为空（''/undefined/null）→ 默认色，color_name=null，直接放行（存量兼容）；
 * - 非空 → 必须存在于该商品色号档案且 active，否则 400；返回档案 color_name 做快照。
 */
export async function resolveItemColors(
  items: Array<{ product_id: string; color_code?: string | null }>,
): Promise<Map<string, string>> {
  // key: `${product_id}|${color_code}` → color_name（空色号不进入 map）
  const result = new Map<string, string>();
  const wanted = new Map<string, Set<string>>(); // product_id → Set<color_code>
  for (const item of items) {
    const code = (item.color_code ?? '').trim();
    if (!code) continue;
    if (!wanted.has(item.product_id)) wanted.set(item.product_id, new Set());
    wanted.get(item.product_id)!.add(code);
  }
  if (wanted.size === 0) return result;

  const supabase = getSupabaseClient();
  const productIds = [...wanted.keys()];
  const { data, error } = await supabase
    .from('md_product_colors')
    .select('product_id, color_code, color_name, status')
    .in('product_id', productIds);
  if (error) throwDbError(error, '校验色号档案');

  const archive = new Map<string, { color_name: string; status: string }>();
  for (const row of data ?? []) {
    archive.set(`${row.product_id as string}|${row.color_code as string}`, {
      color_name: row.color_name as string,
      status: row.status as string,
    });
  }
  for (const [pid, codes] of wanted) {
    for (const code of codes) {
      const hit = archive.get(`${pid}|${code}`);
      if (!hit) throw new ApiError(400, 'MD.COLOR_NOT_FOUND', `色号 ${code} 不存在于商品色号档案，请先在商品资料中维护`);
      if (hit.status !== 'active') throw new ApiError(400, 'MD.COLOR_DISABLED', `色号 ${code} 已停用，不能用于新单据`);
      result.set(`${pid}|${code}`, hit.color_name);
    }
  }
  return result;
}

/** 快捷取回某行的 color_name 快照（配合 resolveItemColors 返回值） */
export function colorNameOf(resolved: Map<string, string>, productId: string, colorCode: string | null | undefined): string | null {
  const code = (colorCode ?? '').trim();
  if (!code) return null;
  return resolved.get(`${productId}|${code}`) ?? null;
}

/** 归一化色号：null/undefined/空白 → ''（默认色） */
export function normalizeColorCode(colorCode: string | null | undefined): string {
  return (colorCode ?? '').trim();
}
