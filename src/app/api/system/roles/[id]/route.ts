import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { clientIp, writeAuditLog } from '@/server/system/audit';
import { deleteRole, updateRole } from '@/server/system/roles';

const updateSchema = z.object({
  name: z.string().trim().min(1).max(64).optional(),
  description: z.string().trim().max(256).nullish(),
  data_scope: z.enum(['all', 'dept', 'self']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: Ctx) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'sys.write');
    const { id } = await context.params;
    const input = updateSchema.parse(await request.json());
    const updated = await updateRole(id, input);
    await writeAuditLog({
      userId: user.id,
      username: user.username,
      action: 'role.update',
      resource: 'sys_role',
      resourceId: id,
      detail: { changes: input },
      ip: clientIp(request),
    });
    return ok(updated);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('SYS.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}

export async function DELETE(request: NextRequest, context: Ctx) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'sys.write');
    const { id } = await context.params;
    await deleteRole(id);
    await writeAuditLog({
      userId: user.id,
      username: user.username,
      action: 'role.delete',
      resource: 'sys_role',
      resourceId: id,
      ip: clientIp(request),
    });
    return ok({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
