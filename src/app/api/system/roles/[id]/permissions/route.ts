import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { PERMISSION_CATALOG } from '@/server/auth/permissions';
import { fail, handleError, ok } from '@/server/http';
import { clientIp, writeAuditLog } from '@/server/system/audit';
import { getRolePermissions, setRolePermissions } from '@/server/system/roles';

type Ctx = { params: Promise<{ id: string }> };

const setSchema = z.object({
  permissions: z.array(z.string().trim().min(1)).max(100),
});

export async function GET(request: NextRequest, context: Ctx) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'sys.read');
    const { id } = await context.params;
    const result = await getRolePermissions(id);
    return ok({ ...result, catalog: PERMISSION_CATALOG });
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: NextRequest, context: Ctx) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'sys.write');
    const { id } = await context.params;
    const input = setSchema.parse(await request.json());
    const before = await getRolePermissions(id);
    await setRolePermissions(id, input.permissions);
    await writeAuditLog({
      userId: user.id,
      username: user.username,
      action: 'role.permissions',
      resource: 'sys_role',
      resourceId: id,
      detail: { before: before.permissions, after: input.permissions },
      ip: clientIp(request),
    });
    return ok({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('SYS.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
