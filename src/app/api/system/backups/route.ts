import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { ok, handleError, ApiError } from '@/server/http';
import { BACKUP_SCOPE_GROUPS, createBackup, listBackups } from '@/server/system/backups';
import { parseListQuery } from '@/server/master-data/helpers';

/** 备份历史分页列表 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    requirePermission(auth.user, 'sys.read');
    const sp = request.nextUrl.searchParams;
    const base = parseListQuery(sp);
    const result = await listBackups({
      ...base,
      backup_type: sp.get('backup_type') ?? undefined,
      status: sp.get('status') ?? undefined,
    });
    return ok({ ...result, scope_groups: Object.keys(BACKUP_SCOPE_GROUPS) });
  } catch (error) {
    return handleError(error);
  }
}

const createSchema = z.object({
  backup_type: z.enum(['full', 'partial']),
  scope: z.array(z.string().trim().min(1)).max(20).optional(),
  note: z.string().trim().max(256).nullish(),
});

/** 触发备份（真实快照落库） */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    requirePermission(auth.user, 'sys.write');
    const body = createSchema.parse(await request.json().catch(() => ({})));
    if (body.backup_type === 'partial' && (!body.scope || body.scope.length === 0)) {
      throw new ApiError(400, 'SYS.BAD_PARAM', '按需备份必须指定 scope（表分组）');
    }
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
    const view = await createBackup({
      backup_type: body.backup_type,
      scope: body.scope ?? undefined,
      note: body.note ?? null,
      operator: { id: auth.user.id, username: auth.user.username },
      ip,
    });
    return ok(view, 201);
  } catch (error) {
    return handleError(error);
  }
}
