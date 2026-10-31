import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { clientIp, writeAuditLog } from '@/server/system/audit';
import { createSetting, invalidateSettingCache, listSettings } from '@/server/system/settings';

const createSchema = z.object({
  key: z.string().trim().min(2).max(64),
  name: z.string().trim().min(1, '参数名称不能为空').max(128),
  value: z.string().max(4000),
  value_type: z.enum(['number', 'string', 'boolean', 'json']).optional(),
  group_name: z.string().trim().max(64).nullish(),
  description: z.string().trim().max(256).nullish(),
  is_sensitive: z.boolean().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'sys.read');
    const params = request.nextUrl.searchParams;
    return ok(
      await listSettings({
        page: Number(params.get('page')) || 1,
        pageSize: Number(params.get('pageSize')) || 50,
        keyword: params.get('keyword') ?? undefined,
        group: params.get('group') ?? undefined,
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
    if (input.is_sensitive && user.role !== 'admin') {
      return fail('SYS.SENSITIVE', '敏感参数仅系统管理员可创建', 403);
    }
    const created = await createSetting(input, user.id);
    invalidateSettingCache(created.key);
    await writeAuditLog({
      userId: user.id,
      username: user.username,
      action: 'setting.create',
      resource: 'sys_setting',
      resourceId: created.key,
      detail: { key: created.key, value: created.value, group_name: created.group_name },
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
