/**
 * 基础资料扩充：计量单位（md_units）CRUD，含单位换算法则
 * 权限：读写 md.write / md.read，staff 只读。
 */
import { ApiError } from '@/server/http';
import { throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface UnitView {
  id: string;
  unit_code: string;
  unit_name: string;
  base_unit: string;
  conversion_ratio: string;
  remark: string | null;
  is_active: boolean;
}

export interface UnitInput {
  unit_code: string;
  unit_name: string;
  base_unit: string;
  conversion_ratio: string | number;
  remark?: string | null;
  is_active?: boolean;
}

export async function listUnits(query: ListQuery): Promise<PagedResult<UnitView>> {
  const supabase = getSupabaseClient();
  let req = supabase.from('md_units').select('*', { count: 'exact' });
  const kw = query.keyword?.trim();
  if (kw) req = req.or(`unit_code.ilike.%${kw}%,unit_name.ilike.%${kw}%`);
  const { data, error, count } = await req
    .order('unit_code', { ascending: true })
    .range((query.page - 1) * query.pageSize, query.page * query.pageSize - 1);
  if (error) throwDbError(error, '查询计量单位');
  return {
    items: (data ?? []).map(mapUnit),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

export async function createUnit(input: UnitInput): Promise<UnitView> {
  if (!input.unit_code?.trim() || !input.unit_name?.trim() || !input.base_unit?.trim()) {
    throw new ApiError(400, 'UNIT.REQUIRED', '单位编码、名称、基准单位均为必填');
  }
  const supabase = getSupabaseClient();
  const row = {
    unit_code: input.unit_code.trim(),
    unit_name: input.unit_name.trim(),
    base_unit: input.base_unit.trim(),
    conversion_ratio: String(input.conversion_ratio ?? 1),
    remark: input.remark?.trim() || null,
    is_active: input.is_active ?? true,
  };
  const { data, error } = await supabase.from('md_units').insert(row).select().single();
  if (error) throwDbError(error, '新增计量单位');
  return mapUnit(data);
}

export async function updateUnit(id: string, input: UnitInput): Promise<UnitView> {
  const supabase = getSupabaseClient();
  const patch: Record<string, unknown> = {};
  if (input.unit_code !== undefined) patch.unit_code = input.unit_code.trim();
  if (input.unit_name !== undefined) patch.unit_name = input.unit_name.trim();
  if (input.base_unit !== undefined) patch.base_unit = input.base_unit.trim();
  if (input.conversion_ratio !== undefined) patch.conversion_ratio = String(input.conversion_ratio);
  if (input.remark !== undefined) patch.remark = input.remark?.trim() || null;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  const { data, error } = await supabase.from('md_units').update(patch).eq('id', id).select().single();
  if (error) throwDbError(error, '更新计量单位');
  return mapUnit(data);
}

export async function removeUnit(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('md_units').delete().eq('id', id);
  if (error) throwDbError(error, '删除计量单位');
}

function mapUnit(r: Record<string, unknown>): UnitView {
  return {
    id: r.id as string,
    unit_code: r.unit_code as string,
    unit_name: r.unit_name as string,
    base_unit: r.base_unit as string,
    conversion_ratio: r.conversion_ratio as string,
    remark: (r.remark as string | null) ?? null,
    is_active: Boolean(r.is_active),
  };
}