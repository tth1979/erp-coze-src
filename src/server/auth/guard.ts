import type { NextRequest } from 'next/server';
import type { SysUser } from '@/storage/database/shared/schema';
import { ApiError } from '@/server/http';
import {
  hasEffectivePermission,
  hasPermission,
  listPermissions,
  resolveUserAuthorization,
  type AuthorizedUser,
  type DataScope,
} from './permissions';
import { resolveSession, SESSION_COOKIE } from './session';

export interface AuthContext {
  user: AuthorizedUser;
  /** 有效权限点（内置角色 ∪ 自定义角色） */
  permissions: string[];
  /** 数据范围（数据级粒度，取所有角色最严格者） */
  dataScope: DataScope;
}

/** 认证守卫：从 cookie 解析会话，未登录抛 401；挂载有效授权（自定义角色并集 + 数据范围） */
export async function requireAuth(request: NextRequest): Promise<AuthContext> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) throw new ApiError(401, 'AUTH.UNAUTHORIZED', '未登录或会话已过期');
  const resolved = await resolveSession(token);
  if (!resolved) throw new ApiError(401, 'AUTH.UNAUTHORIZED', '未登录或会话已过期');
  const authz = await resolveUserAuthorization(resolved.user);
  const user: AuthorizedUser = {
    ...resolved.user,
    effectivePermissions: authz.permissions,
    dataScope: authz.dataScope,
    customRoleIds: authz.roleIds,
  };
  return { user, permissions: authz.permissions, dataScope: authz.dataScope };
}

/** 授权守卫：权限不足抛 403（判定权全在后端；优先读挂载的有效权限） */
export function requirePermission(user: SysUser, permission: string): void {
  const effective = (user as AuthorizedUser).effectivePermissions;
  const allowed = effective
    ? hasEffectivePermission(effective, permission)
    : hasPermission(user.role, permission);
  if (!allowed) {
    throw new ApiError(403, 'AUTH.FORBIDDEN', '没有执行该操作的权限');
  }
}

/** 取用户有效权限点（兜底回退到内置角色静态映射） */
export function effectivePermissionsOf(user: SysUser): string[] {
  const effective = (user as AuthorizedUser).effectivePermissions;
  return effective ?? listPermissions(user.role);
}

/** 数据范围（未挂载时恒 all，不改变存量行为） */
export function dataScopeOf(user: SysUser): DataScope {
  return (user as AuthorizedUser).dataScope ?? 'all';
}
