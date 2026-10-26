/**
 * 系统数据字典（dict_*）：字典类型 + 字典项 CRUD 与引用查询
 *
 * 权限：读写走 md.write / md.read（字典作为基础资料维护）。
 */
import { ApiError } from '@/server/http';
import { throwDbError, emptyToNull, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export interface DictTypeView {
  id: string;
  type_code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  sort: number;
}

export interface DictItemView {
  id: string;
  type_code: string;
  item_code: string;
  label: string;
  extra: Record<string, unknown> | null;
  sort: number;
  is_active: boolean;
}

export async function listTypes(query: ListQuery): Promise<PagedResult<DictTypeView>> {
  const supabase = getSupabaseClient();
  let req = supabase.from('dict_system_types').select('*', { count: 'exact' }).order('sort', { ascending: true });
  const kw = query.keyword?.trim();
  if (kw) req = req.or(`name.ilike.%${kw}%,type_code.ilike.%${kw}%`);
  const { data, error, count } = await req.range((query.page - 1) * query.pageSize, query.page * query.pageSize - 1);
  if (error) throwDbError(error, '查询字典类型');
  return {
    items: (data ?? []).map((r) => ({
      id: r.id as string,
      type_code: r.type_code as string,
      name: r.name as string,
      description: (r.description as string | null) ?? null,
      is_system: Boolean(r.is_system),
      is_active: Boolean(r.is_active),
      sort: Number(r.sort ?? 0),
    })),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

export interface DictItemInput {
  type_code: string;
  item_code: string;
  label: string;
  extra?: Record<string, unknown> | null;
  sort?: number;
  is_active?: boolean;
}

export interface DictTypeInput {
  type_code: string;
  name: string;
  description?: string | null;
  sort?: number;
  is_active?: boolean;
}

export async function createDictType(input: DictTypeInput): Promise<DictTypeView> {
  if (!input.type_code?.trim() || !input.name?.trim()) {
    throw new ApiError(400, 'DICT.REQUIRED', '类型编码、名称均为必填');
  }
  const supabase = getSupabaseClient();
  const row = {
    type_code: input.type_code.trim(),
    name: input.name.trim(),
    description: emptyToNull(input.description),
    sort: input.sort ?? 0,
    is_active: input.is_active ?? true,
  };
  const { data, error } = await supabase.from('dict_system_types').insert(row).select().single();
  if (error) throwDbError(error, '新增字典类型');
  return mapType(data);
}

export async function getDictType(id: string): Promise<DictTypeView> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('dict_system_types').select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询字典类型');
  if (!data) throw new ApiError(404, 'DICT.NOT_FOUND', '字典类型不存在');
  return mapType(data);
}

export async function updateDictType(id: string, input: DictTypeInput): Promise<DictTypeView> {
  const supabase = getSupabaseClient();
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = emptyToNull(input.description);
  if (input.sort !== undefined) patch.sort = input.sort;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  const { data, error } = await supabase.from('dict_system_types').update(patch).eq('id', id).select().single();
  if (error) throwDbError(error, '更新字典类型');
  return mapType(data);
}

export async function removeDictType(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: typeRow } = await supabase.from('dict_system_types').select('is_system,type_code').eq('id', id).maybeSingle();
  if (typeRow?.is_system) throw new ApiError(400, 'DICT.SYSTEM_TYPE', '系统内置字典类型不可删除');
  // 级联删除该类型下的字典项
  const { error: itErr } = await supabase.from('dict_system_items').delete().eq('type_code', typeRow?.type_code ?? id);
  if (itErr) throwDbError(itErr, '清理字典项');
  const { error } = await supabase.from('dict_system_types').delete().eq('id', id);
  if (error) throwDbError(error, '删除字典类型');
}

export async function createDictItem(input: DictItemInput): Promise<DictItemView> {
  if (!input.type_code?.trim() || !input.item_code?.trim() || !input.label?.trim()) {
    throw new ApiError(400, 'DICT.REQUIRED', '字典类型、编码、名称均为必填');
  }
  // 确保类型存在
  const supabase = getSupabaseClient();
  const { data: typeRows } = await supabase.from('dict_system_types').select('id').eq('type_code', input.type_code);
  if (!(typeRows ?? []).length) throw new ApiError(400, 'DICT.TYPE_NOT_FOUND', '字典类型不存在');

  const row = {
    type_code: input.type_code.trim(),
    item_code: input.item_code.trim(),
    label: input.label.trim(),
    extra: input.extra ?? {},
    sort: input.sort ?? 0,
    is_active: input.is_active ?? true,
  };
  const { data, error } = await supabase.from('dict_system_items').insert(row).select().single();
  if (error) throwDbError(error, '新增字典项');
  return mapItem(data);
}

export async function updateDictItem(id: string, input: DictItemInput): Promise<DictItemView> {
  const supabase = getSupabaseClient();
  const patch: Record<string, unknown> = {};
  if (input.item_code !== undefined) patch.item_code = input.item_code.trim();
  if (input.label !== undefined) patch.label = input.label.trim();
  if (input.extra !== undefined) patch.extra = input.extra ?? {};
  if (input.sort !== undefined) patch.sort = input.sort;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  const { data, error } = await supabase.from('dict_system_items').update(patch).eq('id', id).select().single();
  if (error) throwDbError(error, '更新字典项');
  return mapItem(data);
}

export async function removeDictItem(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('dict_system_items').delete().eq('id', id);
  if (error) throwDbError(error, '删除字典项');
}

/** 按 type_code 返回活跃字典项（下拉引用） */
export async function lookupDict(typeCode: string): Promise<DictItemView[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('dict_system_items')
    .select('*')
    .eq('type_code', typeCode)
    .eq('is_active', true)
    .order('sort', { ascending: true });
  if (error) throwDbError(error, '查询字典引用');
  return (data ?? []).map(mapItem);
}

function mapItem(r: Record<string, unknown>): DictItemView {
  let extra: Record<string, unknown> | null = null;
  if (r.extra && typeof r.extra === 'object') extra = r.extra as Record<string, unknown>;
  return {
    id: r.id as string,
    type_code: r.type_code as string,
    item_code: r.item_code as string,
    label: r.label as string,
    extra,
    sort: Number(r.sort ?? 0),
    is_active: Boolean(r.is_active),
  };
}

export function serializeTypeDescription(value: string | null | undefined): string | null {
  return emptyToNull(value);
}

export interface DictItemListQuery extends ListQuery {
  type_code?: string;
}

/** 字典项分页（可按 type_code 精确过滤） */
export async function listItems(query: DictItemListQuery): Promise<PagedResult<DictItemView>> {
  const supabase = getSupabaseClient();
  let req = supabase.from('dict_system_items').select('*', { count: 'exact' });
  if (query.type_code) req = req.eq('type_code', query.type_code);
  const kw = query.keyword?.trim();
  if (kw) req = req.or(`label.ilike.%${kw}%,item_code.ilike.%${kw}%`);
  const { data, error, count } = await req
    .order('sort', { ascending: true })
    .range((query.page - 1) * query.pageSize, query.page * query.pageSize - 1);
  if (error) throwDbError(error, '查询字典项');
  return {
    items: (data ?? []).map(mapItem),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

function mapType(r: Record<string, unknown>): DictTypeView {
  return {
    id: r.id as string,
    type_code: r.type_code as string,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    is_system: Boolean(r.is_system),
    is_active: Boolean(r.is_active),
    sort: Number(r.sort ?? 0),
  };
}