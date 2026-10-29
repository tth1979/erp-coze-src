import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { getTaxFiling } from '@/server/tax/tax';

/** GET /api/tax/filing?period=YYYY-MM  增值税纳税申报主表数据来源（按期间汇总销项/进项 + 应纳/留抵） */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.read');
    const period = request.nextUrl.searchParams.get('period')?.trim() || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(period)) return Response.json({ code: 'TAX.BAD_PERIOD', message: '期间格式应为 YYYY-MM' }, { status: 400 });
    const result = await getTaxFiling(period);
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}