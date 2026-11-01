import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { ok, handleError, ApiError } from '@/server/http';
import { runIntegrityChecks, type CheckGroup } from '@/server/system/integrity';
import { writeAuditLog } from '@/server/system/audit';

const GROUPS: CheckGroup[] = ['manual', 'daily', 'startup'];

/** 触发数据一致性断言跑批（手动/日程脚本均可调用） */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    requirePermission(auth.user, 'sys.write');
    const body = (await request.json().catch(() => ({}))) as { group?: string };
    const group = (GROUPS as string[]).includes(body.group ?? '') ? (body.group as CheckGroup) : 'manual';
    const result = await runIntegrityChecks(group);
    await writeAuditLog({
      userId: auth.user.id,
      username: auth.user.username,
      action: 'integrity.run',
      resource: 'sys_integrity_checks',
      resourceId: result.run_id,
      detail: { group, ...result.summary },
    });
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}

/** 查询接口契约（供日程/脚本发现触发方式） */
export async function GET(request: NextRequest) {
  try {
    await requireAuth(request);
    return ok({
      trigger: 'POST /api/system/integrity/run',
      body: { group: 'manual | daily | startup' },
      note: '可由 cron/日程脚本携带合法会话调用；group 缺省 manual',
    });
  } catch (error) {
    return handleError(error);
  }
}
