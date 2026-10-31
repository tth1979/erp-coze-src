import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { clientIp, writeAuditLog } from '@/server/system/audit';
import { updateUserDept } from '@/server/system/roles';

const deptSchema = z.object({
  dept: z.string().trim().max(64).nullish(),
});

/** 更新用户部门（数据级"本部门"范围的归属依据） */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'sys.write');
    const { id } = await context.params;
    const input = deptSchema.parse(await request.json());
    const dept = input.dept && input.dept.trim() ? input.dept.trim() : null;
    await updateUserDept(id, dept);
    await writeAuditLog({
      userId: user.id,
      username: user.username,
      action: 'user.dept',
      resource: 'sys_user',
      resourceId: id,
      detail: { dept },
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
