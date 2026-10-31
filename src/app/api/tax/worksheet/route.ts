import { NextRequest } from 'next/server';
import { fail, handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { getWorksheet } from '@/server/tax/worksheet';

/** GET /api/tax/worksheet?period=YYYY-MM  申报底稿（销项/进项/应纳/预缴/应补退 + 来源） */
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'tax.read');
    const period = req.nextUrl.searchParams.get('period')?.trim() || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) return fail('TAX.BAD_PERIOD', '期间格式应为 YYYY-MM', 400);
    return ok(await getWorksheet(period));
  } catch (error) {
    return handleError(error);
  }
}
