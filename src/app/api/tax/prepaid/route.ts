import { NextRequest } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { listPrepaid, createPrepaid, type PrepaidInput } from '@/server/tax/prepaid';

/** GET /api/tax/prepaid  异地预缴分页（关键字/期间） */
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'tax.read');
    const sp = req.nextUrl.searchParams;
    const result = await listPrepaid({
      page: Number(sp.get('page')) || 1,
      pageSize: Number(sp.get('pageSize')) || 20,
      keyword: sp.get('keyword') || '',
      period: sp.get('period') || undefined,
      status: sp.get('status') || undefined,
    });
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}

/** POST /api/tax/prepaid  登记异地预缴 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'tax.write');
    const body = (await req.json()) as PrepaidInput;
    const result = await createPrepaid(body, user.id);
    return ok(result, 201);
  } catch (error) {
    return handleError(error);
  }
}
