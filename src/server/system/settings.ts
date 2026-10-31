/**
 * 参数中心（sys_settings）
 * - 阈值/基准只在参数中心维护，模块只引用不重定义
 * - key 唯一 409；敏感参数仅 admin 可改；内置参数(is_system)不可删
 */
import { ApiError } from '@/server/http';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { emptyToNull, escapeOrKeyword, throwDbError } from '@/server/master-data/helpers';

const TABLE = 'sys_settings';

export interface SettingRow {
  id: string;
  key: string;
  name: string;
  value: string;
  value_type: string;
  group_name: string;
  description: string | null;
  is_sensitive: boolean;
  is_system: boolean;
  updated_by_name: string | null;
  updated_at: string;
}

function mapRow(r: Record<string, unknown>, updatedByName?: string | null): SettingRow {
  return {
    id: String(r.id),
    key: String(r.key),
    name: String(r.name),
    value: String(r.value ?? ''),
    value_type: String(r.value_type ?? 'string'),
    group_name: String(r.group_name ?? '通用'),
    description: (r.description as string | null) ?? null,
    is_sensitive: Boolean(r.is_sensitive),
    is_system: Boolean(r.is_system),
    updated_by_name: updatedByName ?? null,
    updated_at: String(r.updated_at),
  };
}

export interface SettingListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  group?: string;
}

export async function listSettings(query: SettingListQuery): Promise<{
  items: SettingRow[];
  total: number;
  page: number;
  page_size: number;
  groups: string[];
}> {
  const supabase = getSupabaseClient();
  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize = Math.min(query.pageSize && query.pageSize > 0 ? query.pageSize : 50, 100);
  let q = supabase.from(TABLE).select('*', { count: 'exact' });
  if (query.group) q = q.eq('group_name', query.group);
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    q = q.or(`key.ilike.%${kw}%,name.ilike.%${kw}%,description.ilike.%${kw}%`);
  }
  const { data, error, count } = await q
    .order('group_name', { ascending: true })
    .order('key', { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(500, 'SYS.DB', error.message);
  const { data: groupRows } = await supabase.from(TABLE).select('group_name');
  const groups = [...new Set((groupRows ?? []).map((g) => String((g as Record<string, unknown>).group_name)))].sort();
  // 批量补最近修改人姓名（两步查询，不依赖嵌入）
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const updaterIds = [...new Set(rows.map((r) => r.updated_by).filter(Boolean))] as string[];
  const nameMap = new Map<string, string>();
  if (updaterIds.length > 0) {
    const { data: users } = await supabase.from('sys_users').select('id,username,display_name').in('id', updaterIds);
    for (const u of users ?? []) {
      const row = u as Record<string, unknown>;
      nameMap.set(String(row.id), String(row.display_name ?? row.username));
    }
  }
  return {
    items: rows.map((r) => mapRow(r, r.updated_by ? nameMap.get(String(r.updated_by)) : null)),
    total: count ?? rows.length,
    page,
    page_size: pageSize,
    groups,
  };
}

export interface SettingInput {
  key: string;
  name: string;
  value: string;
  value_type?: string;
  group_name?: string | null;
  description?: string | null;
  is_sensitive?: boolean;
}

/** 按值类型校验参数值（导出供 golden 回归与路由复用） */
export function validateValueByType(value: string, valueType: string): void {
  if (valueType === 'number' && !Number.isFinite(Number(value))) {
    throw new ApiError(400, 'SYS.BAD_VALUE', '数值类型参数的值必须是数字');
  }
  if (valueType === 'boolean' && !['true', 'false', '1', '0'].includes(value)) {
    throw new ApiError(400, 'SYS.BAD_VALUE', '布尔类型参数的值必须是 true/false');
  }
  if (valueType === 'json') {
    try {
      JSON.parse(value);
    } catch {
      throw new ApiError(400, 'SYS.BAD_VALUE', 'JSON 类型参数的值不是合法 JSON');
    }
  }
}

export async function createSetting(input: SettingInput, operatorId: string): Promise<SettingRow> {
  const key = input.key.trim();
  if (!/^[a-z][a-z0-9_.-]{1,63}$/.test(key)) {
    throw new ApiError(400, 'SYS.BAD_KEY', '参数 key 须以小写字母开头，仅含小写字母/数字/._-，2-64 位');
  }
  const valueType = input.value_type ?? 'string';
  validateValueByType(input.value, valueType);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      key,
      name: input.name.trim(),
      value: String(input.value),
      value_type: valueType,
      group_name: input.group_name?.trim() || '通用',
      description: emptyToNull(input.description),
      is_sensitive: Boolean(input.is_sensitive),
      is_system: false,
      updated_by: operatorId,
    })
    .select('*')
    .single();
  if (error) throwDbError(error, '创建参数');
  return mapRow(data as Record<string, unknown>);
}

/**
 * 更新参数（敏感参数仅 admin：isAdmin 由路由判定后传入）
 * 内置参数仅可改 value/description，不可改 key/类型/敏感标记。
 */
export async function updateSetting(
  id: string,
  input: Partial<SettingInput>,
  operatorId: string,
  isAdmin: boolean,
): Promise<{ before: SettingRow; after: SettingRow }> {
  const supabase = getSupabaseClient();
  const { data: existing, error: loadErr } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (loadErr) throw new ApiError(500, 'SYS.DB', loadErr.message);
  if (!existing) throw new ApiError(404, 'SYS.NOT_FOUND', '参数不存在');
  const before = mapRow(existing as Record<string, unknown>);
  if (before.is_sensitive && !isAdmin) {
    throw new ApiError(403, 'SYS.SENSITIVE', '敏感参数仅系统管理员可修改');
  }
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: operatorId };
  if (!before.is_system) {
    if (input.name !== undefined) patch.name = input.name.trim();
    if (input.value_type !== undefined) patch.value_type = input.value_type;
    if (input.group_name != null) patch.group_name = input.group_name.trim() || '通用';
    if (input.is_sensitive !== undefined) patch.is_sensitive = Boolean(input.is_sensitive);
  }
  if (input.value !== undefined) {
    validateValueByType(input.value, (patch.value_type as string) ?? before.value_type);
    patch.value = String(input.value);
  }
  if (input.description !== undefined) patch.description = emptyToNull(input.description);
  const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select('*').single();
  if (error) throwDbError(error, '更新参数');
  return { before, after: mapRow(data as Record<string, unknown>) };
}

export async function deleteSetting(id: string, isAdmin: boolean): Promise<SettingRow> {
  const supabase = getSupabaseClient();
  const { data: existing, error: loadErr } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (loadErr) throw new ApiError(500, 'SYS.DB', loadErr.message);
  if (!existing) throw new ApiError(404, 'SYS.NOT_FOUND', '参数不存在');
  const row = mapRow(existing as Record<string, unknown>);
  if (row.is_system) throw new ApiError(400, 'SYS.SYSTEM', '内置参数不可删除，仅可修改值');
  if (row.is_sensitive && !isAdmin) throw new ApiError(403, 'SYS.SENSITIVE', '敏感参数仅系统管理员可删除');
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throwDbError(error, '删除参数');
  return row;
}

/* ---------- 参数读取（模块引用入口） ---------- */

const SETTING_CACHE = new Map<string, { value: string; type: string; expiresAt: number }>();
const SETTING_TTL_MS = 60_000;

/** 按 key 读取参数原始值（带 60s 缓存；模块只引用不重定义） */
export async function getSettingRaw(key: string): Promise<{ value: string; valueType: string } | null> {
  const cached = SETTING_CACHE.get(key);
  if (cached && cached.expiresAt > Date.now()) return { value: cached.value, valueType: cached.type };
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(TABLE).select('value,value_type').eq('key', key).maybeSingle();
  if (error) throw new ApiError(500, 'SYS.DB', error.message);
  if (!data) return null;
  const row = data as Record<string, unknown>;
  SETTING_CACHE.set(key, {
    value: String(row.value ?? ''),
    type: String(row.value_type ?? 'string'),
    expiresAt: Date.now() + SETTING_TTL_MS,
  });
  return { value: String(row.value ?? ''), valueType: String(row.value_type ?? 'string') };
}

/** 数值参数：读取失败/缺失时回退默认值 */
export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const raw = await getSettingRaw(key);
  if (!raw) return fallback;
  const n = Number(raw.value);
  return Number.isFinite(n) ? n : fallback;
}

/** 参数变更后失效缓存 */
export function invalidateSettingCache(key?: string): void {
  if (key) SETTING_CACHE.delete(key);
  else SETTING_CACHE.clear();
}

/** 参数值按类型解析（纯函数，供 golden 用例） */
export function parseSettingValue(raw: string, valueType: string): number | string | boolean | unknown {
  switch (valueType) {
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : 0;
    }
    case 'boolean':
      return raw === 'true' || raw === '1';
    case 'json':
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    default:
      return raw;
  }
}
