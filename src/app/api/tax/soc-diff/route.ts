import { NextRequest } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { listSocDiff, createSocDiff, type SocDiffInput } from '@/server/tax/soc-diff';

/** GET /api/tax/soc-diff  税会差异分页（关键字/期间/类型） */
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'tax.read');
    const sp = req.nextUrl.searchParams;
    const result = await listSocDiff({
      page: Number(sp.get('page')) || 1,
      pageSize: Number(sp.get('pageSize')) || 20,
      keyword: sp.get('keyword') || '',
      period: sp.get('period') || undefined,
      diff_type: sp.get('diff_type') || undefined,
    });
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}

/** POST /api/tax/soc-diff  登记税会差异（差异额服务端计算） */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'tax.write');
    const body = (await req.json()) as SocDiffInput;
    const result = await createSocDiff(body, user.id);
    return ok(result, 201);
  } catch (error) {
    return handleError(error);
  }
}
