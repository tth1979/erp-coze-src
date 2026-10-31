import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { clientIp, writeAuditLog } from '@/server/system/audit';
import { createRole, listRoles } from '@/server/system/roles';

const createSchema = z.object({
  code: z.string().trim().min(2).max(32),
  name: z.string().trim().min(1, '角色名称不能为空').max(64),
  description: z.string().trim().max(256).nullish(),
  data_scope: z.enum(['all', 'dept', 'self']).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'sys.read');
    const params = request.nextUrl.searchParams;
    return ok(
      await listRoles({
        page: Number(params.get('page')) || 1,
        pageSize: Number(params.get('pageSize')) || 50,
        keyword: params.get('keyword') ?? undefined,
      }),
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'sys.write');
    const input = createSchema.parse(await request.json());
    const created = await createRole(input, user.id);
    await writeAuditLog({
      userId: user.id,
      username: user.username,
      action: 'role.create',
      resource: 'sys_role',
      resourceId: created.id,
      detail: { code: created.code, name: created.name, data_scope: created.data_scope },
      ip: clientIp(request),
    });
    return ok(created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('SYS.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
