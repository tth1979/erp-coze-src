import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { clientIp, writeAuditLog } from '@/server/system/audit';
import { setUserRoles } from '@/server/system/roles';

const assignSchema = z.object({
  role_ids: z.array(z.string().trim().min(1)).max(20),
});

/** 整集替换用户的自定义角色分配 */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'sys.write');
    const { id } = await context.params;
    const input = assignSchema.parse(await request.json());
    await setUserRoles(id, input.role_ids, user.id);
    await writeAuditLog({
      userId: user.id,
      username: user.username,
      action: 'user.roles',
      resource: 'sys_user',
      resourceId: id,
      detail: { role_ids: input.role_ids },
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
