import type { NextRequest } from 'next/server';
import type { SysUser } from '@/storage/database/shared/schema';
import { ApiError } from '@/server/http';
import { hasPermission } from './permissions';
import { resolveSession, SESSION_COOKIE } from './session';

export interface AuthContext {
  user: SysUser;
}

/** 认证守卫：从 cookie 解析会话，未登录抛 401 */
export async function requireAuth(request: NextRequest): Promise<AuthContext> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) throw new ApiError(401, 'AUTH.UNAUTHORIZED', '未登录或会话已过期');
  const resolved = await resolveSession(token);
  if (!resolved) throw new ApiError(401, 'AUTH.UNAUTHORIZED', '未登录或会话已过期');
  return { user: resolved.user };
}

/** 授权守卫：角色权限不足抛 403（判定权全在后端） */
export function requirePermission(user: SysUser, permission: string): void {
  if (!hasPermission(user.role, permission)) {
    throw new ApiError(403, 'AUTH.FORBIDDEN', '没有执行该操作的权限');
  }
}
