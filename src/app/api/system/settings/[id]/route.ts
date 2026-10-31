import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { clientIp, writeAuditLog } from '@/server/system/audit';
import { deleteSetting, invalidateSettingCache, updateSetting } from '@/server/system/settings';

const updateSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  value: z.string().max(4000).optional(),
  value_type: z.enum(['number', 'string', 'boolean', 'json']).optional(),
  group_name: z.string().trim().max(64).nullish(),
  description: z.string().trim().max(256).nullish(),
  is_sensitive: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, context: Ctx) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'sys.write');
    const { id } = await context.params;
    const input = updateSchema.parse(await request.json());
    const { before, after } = await updateSetting(id, input, user.id, user.role === 'admin');
    invalidateSettingCache(after.key);
    await writeAuditLog({
      userId: user.id,
      username: user.username,
      action: 'setting.update',
      resource: 'sys_setting',
      resourceId: after.key,
      detail: { before: { value: before.value }, after: { value: after.value } },
      ip: clientIp(request),
    });
    return ok(after);
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
    const deleted = await deleteSetting(id, user.role === 'admin');
    invalidateSettingCache(deleted.key);
    await writeAuditLog({
      userId: user.id,
      username: user.username,
      action: 'setting.delete',
      resource: 'sys_setting',
      resourceId: deleted.key,
      ip: clientIp(request),
    });
    return ok({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
