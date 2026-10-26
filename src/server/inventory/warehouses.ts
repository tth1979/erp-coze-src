/**
 * 仓库主数据（inv_warehouses）
 * - 仓库编码唯一（WH01 为默认仓，购销单据未指定仓库时兜底）
 * - 仅启停用（is_active），不提供删除（被单据/库存引用后无法删）
 */
import { z } from 'zod';
import { ApiError } from '@/server/http';
import { throwDbError } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { InvWarehouse } from '@/storage/database/shared/schema';

const warehouseSchema = z.object({
  code: z.string().trim().min(1, '仓库编码必填').max(32),
  name: z.string().trim().min(1, '仓库名称必填').max(64),
  address: z.string().trim().max(128).nullish(),
});

export async function listWarehouses(): Promise<InvWarehouse[]> {
  const { data, error } = await getSupabaseClient()
    .from('inv_warehouses')
    .select('*')
    .order('code', { ascending: true });
  if (error) throwDbError(error, '查询仓库列表');
  return (data ?? []) as InvWarehouse[];
}

export async function createWarehouse(input: unknown): Promise<InvWarehouse> {
  const parsed = warehouseSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(400, 'MD.VALIDATION', parsed.error.issues[0]?.message ?? '参数错误');
  }
  const { data, error } = await getSupabaseClient()
    .from('inv_warehouses')
    .insert({
      code: parsed.data.code.toUpperCase(),
      name: parsed.data.name,
      address: parsed.data.address ?? null,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw new ApiError(400, 'INV.DUPLICATE_WAREHOUSE', '仓库编码已存在');
    throwDbError(error, '新增仓库');
  }
  return data as InvWarehouse;
}

export async function updateWarehouse(id: string, input: unknown): Promise<InvWarehouse> {
  const schema = warehouseSchema.partial().extend({ is_active: z.boolean().optional() });
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ApiError(400, 'MD.VALIDATION', parsed.error.issues[0]?.message ?? '参数错误');
  }
  const updates: Record<string, unknown> = {};
  if (parsed.data.code !== undefined) updates.code = parsed.data.code.toUpperCase();
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.address !== undefined) updates.address = parsed.data.address;
  if (parsed.data.is_active !== undefined) updates.is_active = parsed.data.is_active;
  if (Object.keys(updates).length === 0) throw new ApiError(400, 'MD.VALIDATION', '无可更新字段');

  const { data, error } = await getSupabaseClient()
    .from('inv_warehouses')
    .update(updates)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') throw new ApiError(400, 'INV.DUPLICATE_WAREHOUSE', '仓库编码已存在');
    throwDbError(error, '更新仓库');
  }
  if (!data) throw new ApiError(404, 'INV.WAREHOUSE_NOT_FOUND', '仓库不存在');
  return data as InvWarehouse;
}
