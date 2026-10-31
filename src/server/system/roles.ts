/**
 * 角色与四粒度权限配置（sys_roles / sys_role_permissions / sys_user_roles）
 * - 角色 CRUD：内置角色(is_system)不可删，code 唯一 409
 * - 权限点配置：自定义角色整集替换；内置角色权限以代码为准不可改
 * - 用户-角色分配：自定义角色挂到用户；变更后失效授权缓存
 */
import { ApiError } from '@/server/http';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { emptyToNull, escapeOrKeyword, throwDbError } from '@/server/master-data/helpers';
import { invalidateAuthorizationCache, listPermissions } from '@/server/auth/permissions';
import type { DataScope } from '@/server/auth/permissions';

const ROLE_TABLE = 'sys_roles';
const PERM_TABLE = 'sys_role_permissions';
const USER_ROLE_TABLE = 'sys_user_roles';

export interface RoleRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  data_scope: DataScope;
  is_system: boolean;
  status: string;
  user_count: number;
  permissions: string[];
  created_at: string;
}

function mapRole(r: Record<string, unknown>, userCount = 0, permissions: string[] = []): RoleRow {
  return {
    id: String(r.id),
    code: String(r.code),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
    data_scope: (r.data_scope as DataScope) ?? 'all',
    is_system: Boolean(r.is_system),
    status: String(r.status ?? 'active'),
    user_count: userCount,
    permissions,
    created_at: String(r.created_at),
  };
}

export interface RoleListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
}

export async function listRoles(query: RoleListQuery): Promise<{
  items: RoleRow[];
  total: number;
  page: number;
  page_size: number;
}> {
  const supabase = getSupabaseClient();
  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize = Math.min(query.pageSize && query.pageSize > 0 ? query.pageSize : 50, 100);
  let q = supabase.from(ROLE_TABLE).select('*', { count: 'exact' });
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    q = q.or(`code.ilike.%${kw}%,name.ilike.%${kw}%`);
  }
  const { data, error, count } = await q
    .order('is_system', { ascending: false })
    .order('created_at', { ascending: true })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(500, 'SYS.DB', error.message);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const roleIds = rows.map((r) => String(r.id));

  // 权限点与用户数的批量装载
  const permMap = new Map<string, string[]>();
  const userCountMap = new Map<string, number>();
  if (roleIds.length > 0) {
    const { data: perms } = await supabase.from(PERM_TABLE).select('role_id,permission_key').in('role_id', roleIds);
    for (const p of perms ?? []) {
      const row = p as Record<string, unknown>;
      const list = permMap.get(String(row.role_id)) ?? [];
      list.push(String(row.permission_key));
      permMap.set(String(row.role_id), list);
    }
    const { data: userRoles } = await supabase.from(USER_ROLE_TABLE).select('role_id').in('role_id', roleIds);
    for (const ur of userRoles ?? []) {
      const rid = String((ur as Record<string, unknown>).role_id);
      userCountMap.set(rid, (userCountMap.get(rid) ?? 0) + 1);
    }
  }

  return {
    items: rows.map((r) => {
      const code = String(r.code);
      // 内置角色权限点以代码为准（admin='*'）
      const dbPerms = permMap.get(String(r.id)) ?? [];
      const perms = Boolean(r.is_system) ? (code === 'admin' ? ['*'] : listPermissions(code)) : dbPerms;
      return mapRole(r, userCountMap.get(String(r.id)) ?? 0, perms);
    }),
    total: count ?? rows.length,
    page,
    page_size: pageSize,
  };
}

export interface RoleInput {
  code: string;
  name: string;
  description?: string | null;
  data_scope?: DataScope;
  status?: string;
}

export async function createRole(input: RoleInput, operatorId: string): Promise<RoleRow> {
  const code = input.code.trim();
  if (!/^[a-z][a-z0-9_]{1,31}$/.test(code)) {
    throw new ApiError(400, 'SYS.BAD_CODE', '角色编码须以小写字母开头，仅含小写字母/数字/下划线，2-32 位');
  }
  if (['admin', 'manager', 'staff'].includes(code)) {
    throw new ApiError(409, 'SYS.DUPLICATE', '内置角色编码不可占用');
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(ROLE_TABLE)
    .insert({
      code,
      name: input.name.trim(),
      description: emptyToNull(input.description),
      data_scope: input.data_scope ?? 'all',
      is_system: false,
      status: input.status ?? 'active',
      created_by: operatorId,
    })
    .select('*')
    .single();
  if (error) throwDbError(error, '创建角色');
  return mapRole(data as Record<string, unknown>);
}

export async function updateRole(id: string, input: Partial<RoleInput>): Promise<RoleRow> {
  const supabase = getSupabaseClient();
  const { data: existing, error: loadErr } = await supabase.from(ROLE_TABLE).select('*').eq('id', id).maybeSingle();
  if (loadErr) throw new ApiError(500, 'SYS.DB', loadErr.message);
  if (!existing) throw new ApiError(404, 'SYS.NOT_FOUND', '角色不存在');
  const row = existing as Record<string, unknown>;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = emptyToNull(input.description);
  if (input.data_scope !== undefined) {
    if (Boolean(row.is_system) && input.data_scope !== 'all') {
      throw new ApiError(400, 'SYS.SYSTEM_ROLE', '内置角色数据范围恒为全部，不可修改');
    }
    patch.data_scope = input.data_scope;
  }
  if (input.status !== undefined) {
    if (Boolean(row.is_system) && input.status !== 'active') {
      throw new ApiError(400, 'SYS.SYSTEM_ROLE', '内置角色不可停用');
    }
    patch.status = input.status;
  }
  const { data, error } = await supabase.from(ROLE_TABLE).update(patch).eq('id', id).select('*').single();
  if (error) throwDbError(error, '更新角色');
  // 数据范围/状态变化影响已分配用户的授权
  const { data: assigned } = await supabase.from(USER_ROLE_TABLE).select('user_id').eq('role_id', id);
  for (const ur of assigned ?? []) invalidateAuthorizationCache(String((ur as Record<string, unknown>).user_id));
  return mapRole(data as Record<string, unknown>);
}

export async function deleteRole(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: existing, error: loadErr } = await supabase.from(ROLE_TABLE).select('is_system').eq('id', id).maybeSingle();
  if (loadErr) throw new ApiError(500, 'SYS.DB', loadErr.message);
  if (!existing) throw new ApiError(404, 'SYS.NOT_FOUND', '角色不存在');
  if (Boolean((existing as Record<string, unknown>).is_system)) {
    throw new ApiError(400, 'SYS.SYSTEM_ROLE', '内置角色不可删除');
  }
  // 先取受影响用户再删除（FK cascade 清理 user_roles/role_permissions）
  const { data: assigned } = await supabase.from(USER_ROLE_TABLE).select('user_id').eq('role_id', id);
  const { error } = await supabase.from(ROLE_TABLE).delete().eq('id', id);
  if (error) throwDbError(error, '删除角色');
  for (const ur of assigned ?? []) invalidateAuthorizationCache(String((ur as Record<string, unknown>).user_id));
}

export async function getRolePermissions(roleId: string): Promise<{ role: RoleRow; permissions: string[] }> {
  const supabase = getSupabaseClient();
  const { data: role, error } = await supabase.from(ROLE_TABLE).select('*').eq('id', roleId).maybeSingle();
  if (error) throw new ApiError(500, 'SYS.DB', error.message);
  if (!role) throw new ApiError(404, 'SYS.NOT_FOUND', '角色不存在');
  const row = role as Record<string, unknown>;
  const isSystem = Boolean(row.is_system);
  const code = String(row.code);
  let permissions: string[] = [];
  if (isSystem) {
    permissions = code === 'admin' ? ['*'] : listPermissions(code);
  } else {
    const { data: perms } = await supabase.from(PERM_TABLE).select('permission_key').eq('role_id', roleId);
    permissions = (perms ?? []).map((p) => String((p as Record<string, unknown>).permission_key));
  }
  return { role: mapRole(row, 0, permissions), permissions };
}

/** 整集替换角色权限点（仅自定义角色；内置角色权限以代码为准） */
export async function setRolePermissions(roleId: string, permissionKeys: string[]): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: role, error } = await supabase.from(ROLE_TABLE).select('is_system').eq('id', roleId).maybeSingle();
  if (error) throw new ApiError(500, 'SYS.DB', error.message);
  if (!role) throw new ApiError(404, 'SYS.NOT_FOUND', '角色不存在');
  if (Boolean((role as Record<string, unknown>).is_system)) {
    throw new ApiError(400, 'SYS.SYSTEM_ROLE', '内置角色权限以代码为准，不可配置');
  }
  const unique = [...new Set(permissionKeys.map((k) => k.trim()).filter(Boolean))];
  const { error: delError } = await supabase.from(PERM_TABLE).delete().eq('role_id', roleId);
  if (delError) throwDbError(delError, '重置角色权限');
  if (unique.length > 0) {
    const { error: insError } = await supabase
      .from(PERM_TABLE)
      .insert(unique.map((permission_key) => ({ role_id: roleId, permission_key })));
    if (insError) throwDbError(insError, '写入角色权限');
  }
  const { data: assigned } = await supabase.from(USER_ROLE_TABLE).select('user_id').eq('role_id', roleId);
  for (const ur of assigned ?? []) invalidateAuthorizationCache(String((ur as Record<string, unknown>).user_id));
}

export interface UserRoleView {
  user_id: string;
  username: string;
  display_name: string | null;
  builtin_role: string;
  dept: string | null;
  status: string;
  roles: Array<{ id: string; code: string; name: string }>;
}

export async function listUserRoles(keyword?: string): Promise<UserRoleView[]> {
  const supabase = getSupabaseClient();
  let q = supabase.from('sys_users').select('id,username,display_name,role,dept,status').order('created_at', { ascending: true });
  if (keyword) {
    const kw = escapeOrKeyword(keyword);
    q = q.or(`username.ilike.%${kw}%,display_name.ilike.%${kw}%`);
  }
  const { data: users, error } = await q.limit(200);
  if (error) throw new ApiError(500, 'SYS.DB', error.message);
  const userIds = (users ?? []).map((u) => String((u as Record<string, unknown>).id));
  const assignedMap = new Map<string, Array<{ id: string; code: string; name: string }>>();
  if (userIds.length > 0) {
    const { data: urs } = await supabase.from(USER_ROLE_TABLE).select('user_id,role_id').in('user_id', userIds);
    const roleIds = [...new Set((urs ?? []).map((r) => String((r as Record<string, unknown>).role_id)))];
    let roleMap = new Map<string, { code: string; name: string }>();
    if (roleIds.length > 0) {
      const { data: roles } = await supabase.from(ROLE_TABLE).select('id,code,name').in('id', roleIds);
      roleMap = new Map(
        (roles ?? []).map((r) => {
          const row = r as Record<string, unknown>;
          return [String(row.id), { code: String(row.code), name: String(row.name) }];
        }),
      );
    }
    for (const ur of urs ?? []) {
      const row = ur as Record<string, unknown>;
      const role = roleMap.get(String(row.role_id));
      if (!role) continue;
      const list = assignedMap.get(String(row.user_id)) ?? [];
      list.push({ id: String(row.role_id), ...role });
      assignedMap.set(String(row.user_id), list);
    }
  }
  return (users ?? []).map((u) => {
    const row = u as Record<string, unknown>;
    return {
      user_id: String(row.id),
      username: String(row.username),
      display_name: (row.display_name as string | null) ?? null,
      builtin_role: String(row.role),
      dept: (row.dept as string | null) ?? null,
      status: String(row.status),
      roles: assignedMap.get(String(row.id)) ?? [],
    };
  });
}

/** 整集替换用户的自定义角色分配（内置角色仍在 sys_users.role，不在此管理） */
export async function setUserRoles(userId: string, roleIds: string[], operatorId: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: user, error: userErr } = await supabase.from('sys_users').select('id').eq('id', userId).maybeSingle();
  if (userErr) throw new ApiError(500, 'SYS.DB', userErr.message);
  if (!user) throw new ApiError(404, 'SYS.NOT_FOUND', '用户不存在');
  const unique = [...new Set(roleIds)];
  if (unique.length > 0) {
    const { data: roles, error: roleErr } = await supabase.from(ROLE_TABLE).select('id').in('id', unique);
    if (roleErr) throw new ApiError(500, 'SYS.DB', roleErr.message);
    if ((roles ?? []).length !== unique.length) {
      throw new ApiError(400, 'SYS.BAD_ROLE', '存在无效的角色 id');
    }
  }
  const { error: delError } = await supabase.from(USER_ROLE_TABLE).delete().eq('user_id', userId);
  if (delError) throwDbError(delError, '重置用户角色');
  if (unique.length > 0) {
    const { error: insError } = await supabase
      .from(USER_ROLE_TABLE)
      .insert(unique.map((role_id) => ({ user_id: userId, role_id, created_by: operatorId })));
    if (insError) throwDbError(insError, '分配用户角色');
  }
  invalidateAuthorizationCache(userId);
}

/** 更新用户部门（数据级"本部门"归属依据） */
export async function updateUserDept(userId: string, dept: string | null): Promise<void> {
  const supabase = getSupabaseClient();
  const { data: user, error: userErr } = await supabase.from('sys_users').select('id').eq('id', userId).maybeSingle();
  if (userErr) throw new ApiError(500, 'SYS.DB', userErr.message);
  if (!user) throw new ApiError(404, 'SYS.NOT_FOUND', '用户不存在');
  const { error } = await supabase
    .from('sys_users')
    .update({ dept: dept && dept.trim() ? dept.trim() : null })
    .eq('id', userId);
  if (error) throwDbError(error, '更新用户部门');
  invalidateAuthorizationCache(userId);
}
