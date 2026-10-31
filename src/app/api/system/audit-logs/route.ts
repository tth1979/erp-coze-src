import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { listAuditLogs } from '@/server/system/audit';

/** 审计日志查询（只读：本表触发器禁改禁删，仅追加） */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'sys.read');
    const params = request.nextUrl.searchParams;
    return ok(
      await listAuditLogs({
        page: Number(params.get('page')) || 1,
        pageSize: Number(params.get('pageSize')) || 20,
        keyword: params.get('keyword') ?? undefined,
        userId: params.get('user_id') ?? undefined,
        userKeyword: params.get('user') ?? undefined,
        action: params.get('action') ?? undefined,
        resource: params.get('resource') ?? undefined,
        from: params.get('from') ?? undefined,
        to: params.get('to') ?? undefined,
      }),
    );
  } catch (error) {
    return handleError(error);
  }
}
