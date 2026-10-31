/**
 * 权限体系（T2 静态角色 + T3 自定义角色并集增强）
 *
 * 内置角色（代码为准，不可删除）：
 * - admin   系统管理员（全部权限 '*')
 * - manager 业务主管（读写 + 审批 + 系统管理）
 * - staff   业务员（只读）
 *
 * 四粒度（需求书 2.3.1）：
 * - 菜单级：*.read 权限点驱动导航显隐（app-shell NAV.permission）
 * - 操作级：*.write / *.approve 权限点控制操作入口
 * - 数据级：sys_roles.data_scope（all/dept/self），作用于单据列表查询
 * - 字段级：field.cost_price / field.customer_phone，缺失时服务端脱敏为 null
 *
 * 用户有效权限 = 内置角色权限 ∪ 自定义角色（sys_user_roles→sys_roles(active)）权限并集。
 * 只做并集不做减法，保证不破坏存量行为。
 */
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { SysUser } from '@/storage/database/shared/schema';

export type Role = 'admin' | 'manager' | 'staff';

export const ROLES: readonly Role[] = ['admin', 'manager', 'staff'] as const;

/** 数据范围（数据级粒度）：all 全部 / dept 本部门 / self 本人 */
export type DataScope = 'all' | 'dept' | 'self';

/** 数据范围严格度排名：数值越大越严格，多角色取最严格 */
const SCOPE_RANK: Record<DataScope, number> = { all: 0, dept: 1, self: 2 };

/** 合并两个数据范围：取更严格者（纯函数，供授权解析与 golden 回归） */
export function mergeScope(a: DataScope, b: DataScope): DataScope {
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  admin: ['*'],
  manager: [
    'dashboard.read', 'md.read', 'md.write',
    'po.read', 'po.write', 'po.approve',
    'so.read', 'so.write', 'so.approve',
    'inv.read', 'inv.write', 'inv.approve',
    'ma.read', 'ma.write', 'ma.approve',
    'fin.read', 'fin.write',
    'tax.read', 'tax.write',
    'sys.read', 'sys.write',
    'field.cost_price', 'field.customer_phone',
  ],
  staff: ['dashboard.read', 'md.read', 'po.read', 'so.read', 'inv.read', 'ma.read', 'fin.read', 'tax.read'],
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function listPermissions(role: string): string[] {
  if (!isRole(role)) return [];
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(role: string, permission: string): boolean {
  const perms = listPermissions(role);
  return perms.includes('*') || perms.includes(permission);
}

/** 有效权限判定（含通配） */
export function hasEffectivePermission(perms: readonly string[], permission: string): boolean {
  return perms.includes('*') || perms.includes(permission);
}

/** 权限点目录（四粒度分组，供角色配置页勾选） */
export interface PermissionCatalogEntry {
  key: string;
  label: string;
  granularity: 'menu' | 'operation' | 'data' | 'field';
}

export const PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = [
  { key: 'dashboard.read', label: '仪表盘查看', granularity: 'menu' },
  { key: 'md.read', label: '基础资料查看', granularity: 'menu' },
  { key: 'md.write', label: '基础资料维护', granularity: 'operation' },
  { key: 'po.read', label: '采购查看', granularity: 'menu' },
  { key: 'po.write', label: '采购操作', granularity: 'operation' },
  { key: 'po.approve', label: '采购审批', granularity: 'operation' },
  { key: 'so.read', label: '销售查看', granularity: 'menu' },
  { key: 'so.write', label: '销售操作', granularity: 'operation' },
  { key: 'so.approve', label: '销售审批', granularity: 'operation' },
  { key: 'inv.read', label: '库存查看', granularity: 'menu' },
  { key: 'inv.write', label: '库存操作', granularity: 'operation' },
  { key: 'inv.approve', label: '库存审批', granularity: 'operation' },
  { key: 'ma.read', label: '加工查看', granularity: 'menu' },
  { key: 'ma.write', label: '加工操作', granularity: 'operation' },
  { key: 'ma.approve', label: '加工审批', granularity: 'operation' },
  { key: 'fin.read', label: '财务查看', granularity: 'menu' },
  { key: 'fin.write', label: '财务操作', granularity: 'operation' },
  { key: 'tax.read', label: '税务查看', granularity: 'menu' },
  { key: 'tax.write', label: '税务操作', granularity: 'operation' },
  { key: 'sys.read', label: '系统管理查看', granularity: 'menu' },
  { key: 'sys.write', label: '系统管理操作', granularity: 'operation' },
  { key: 'field.cost_price', label: '成本价可见', granularity: 'field' },
  { key: 'field.customer_phone', label: '客户手机号可见', granularity: 'field' },
];

/** 字段级脱敏映射：权限点 → 需要置 null 的字段名 */
const FIELD_MASKS: ReadonlyArray<{ permission: string; fields: readonly string[] }> = [
  { permission: 'field.cost_price', fields: ['reference_purchase_price', 'cost_price', 'avg_cost', 'gross_margin_rate'] },
  { permission: 'field.customer_phone', fields: ['phone'] },
];

/**
 * 字段级脱敏：对缺少对应字段级权限的行集合，将敏感字段置 null。
 * 纯函数（入参行就地返回新数组），供列表/详情路由在响应前调用。
 */
export function maskSensitiveFields<T extends Record<string, unknown>>(rows: T[], perms: readonly string[]): T[] {
  if (perms.includes('*')) return rows;
  const toMask = FIELD_MASKS.filter((m) => !perms.includes(m.permission));
  if (toMask.length === 0) return rows;
  return rows.map((row) => {
    const next: Record<string, unknown> = { ...row };
    for (const m of toMask) {
      for (const field of m.fields) {
        if (field in next) next[field] = null;
      }
    }
    return next as T;
  });
}

/* ---------- 自定义角色并集解析（带短 TTL 缓存） ---------- */

export interface UserAuthorization {
  permissions: string[];
  dataScope: DataScope;
  roleIds: string[];
}

interface CacheEntry {
  value: UserAuthorization;
  expiresAt: number;
}

const AUTH_CACHE = new Map<string, CacheEntry>();
const AUTH_CACHE_TTL_MS = 60_000;

/** 失效用户授权缓存（角色分配/角色权限变更后调用；不传 userId 则全清） */
export function invalidateAuthorizationCache(userId?: string): void {
  if (userId) AUTH_CACHE.delete(userId);
  else AUTH_CACHE.clear();
}

/**
 * 解析用户有效授权：内置角色权限 ∪ 自定义角色权限（仅 active 角色），
 * 数据范围取所有角色中最严格者（内置角色恒 all，自定义角色可配 dept/self）。
 */
export async function resolveUserAuthorization(user: SysUser): Promise<UserAuthorization> {
  const cached = AUTH_CACHE.get(user.id);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const supabase = getSupabaseClient();
  const basePerms = new Set<string>(listPermissions(user.role));
  const roleIds: string[] = [];
  let dataScope: DataScope = 'all';

  const { data: userRoles, error: urError } = await supabase
    .from('sys_user_roles')
    .select('role_id')
    .eq('user_id', user.id);
  if (urError) {
    // 自定义角色查询失败不阻断登录态：退化为仅内置角色权限
    const fallback: UserAuthorization = { permissions: [...basePerms], dataScope, roleIds };
    AUTH_CACHE.set(user.id, { value: fallback, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
    return fallback;
  }

  const ids = (userRoles ?? []).map((r) => String((r as Record<string, unknown>).role_id));
  if (ids.length > 0) {
    const { data: roles } = await supabase
      .from('sys_roles')
      .select('id,data_scope,status')
      .in('id', ids)
      .eq('status', 'active');
    const activeIds: string[] = [];
    for (const r of roles ?? []) {
      const row = r as Record<string, unknown>;
      activeIds.push(String(row.id));
      const scope = String(row.data_scope ?? 'all') as DataScope;
      dataScope = mergeScope(dataScope, scope);
    }
    roleIds.push(...activeIds);
    if (activeIds.length > 0) {
      const { data: perms } = await supabase
        .from('sys_role_permissions')
        .select('permission_key')
        .in('role_id', activeIds);
      for (const p of perms ?? []) basePerms.add(String((p as Record<string, unknown>).permission_key));
    }
  }

  const value: UserAuthorization = { permissions: [...basePerms], dataScope, roleIds };
  AUTH_CACHE.set(user.id, { value, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
  return value;
}

/**
 * 数据范围过滤：返回当前用户可见的"操作人" id 集合；
 * all → undefined（不加过滤），self → [本人]，dept → 同部门全部用户（本人无部门时退化为 self）。
 */
export async function dataScopeUserIds(user: SysUser, scope: DataScope): Promise<string[] | undefined> {
  if (scope === 'all') return undefined;
  if (scope === 'self') return [user.id];
  const dept = (user as unknown as Record<string, unknown>).dept as string | null | undefined;
  if (!dept) return [user.id];
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('sys_users').select('id').eq('dept', dept);
  if (error) return [user.id];
  const ids = (data ?? []).map((r) => String((r as Record<string, unknown>).id));
  return ids.length > 0 ? ids : [user.id];
}

/** 增强型用户：requireAuth 返回时挂载的有效授权（不改动 SysUser 表结构） */
export interface AuthorizedUser extends SysUser {
  effectivePermissions?: string[];
  dataScope?: DataScope;
  customRoleIds?: string[];
}
