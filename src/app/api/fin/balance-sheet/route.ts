import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { getBalanceSheet } from '@/server/finance/reports';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    requirePermission(auth.user, 'fin.read');
    const period = req.nextUrl.searchParams.get('period') ?? undefined;
    if (!period) return ok({ error: '需要 period (YYYY-MM)' }, 400);
    return ok(await getBalanceSheet(period));
  } catch (e) {
    return handleError(e);
  }
}