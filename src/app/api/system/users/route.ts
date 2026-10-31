import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { listUserRoles } from '@/server/system/roles';

/** 用户-角色分配视图（含自定义角色与部门） */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'sys.read');
    const keyword = request.nextUrl.searchParams.get('keyword') ?? undefined;
    return ok({ items: await listUserRoles(keyword) });
  } catch (error) {
    return handleError(error);
  }
}
