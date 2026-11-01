import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { ok, handleError } from '@/server/http';
import { ASSERTION_CATALOG, listIntegrityChecks } from '@/server/system/integrity';
import { parseListQuery } from '@/server/master-data/helpers';

/** 断言结果历史分页列表 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    requirePermission(auth.user, 'sys.read');
    const sp = request.nextUrl.searchParams;
    const base = parseListQuery(sp);
    const result = await listIntegrityChecks({
      ...base,
      result: sp.get('result') ?? undefined,
      check_key: sp.get('check_key') ?? undefined,
      check_group: sp.get('check_group') ?? undefined,
    });
    return ok({ ...result, catalog: ASSERTION_CATALOG });
  } catch (error) {
    return handleError(error);
  }
}
