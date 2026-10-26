/**
 * 基于角色的权限雏形（T2：users.role 枚举 + 服务端权限映射）
 *
 * 角色：
 * - admin   系统管理员（全部权限）
 * - manager 业务主管（基础资料读写）
 * - staff   业务员（基础资料只读）
 *
 * 升级路径（T3 RBAC）：新增 roles / permissions / role_permissions / user_roles
 * 四表后，本模块替换为数据库驱动，hasPermission 签名保持不变。
 */
export type Role = 'admin' | 'manager' | 'staff';

export const ROLES: readonly Role[] = ['admin', 'manager', 'staff'] as const;

const ROLE_PERMISSIONS: Record<Role, readonly string[]> = {
  admin: ['*'],
  manager: ['dashboard.read', 'md.read', 'md.write'],
  staff: ['dashboard.read', 'md.read'],
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
