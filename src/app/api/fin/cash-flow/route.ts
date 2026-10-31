import { NextRequest } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { getCashFlow } from '@/server/finance/cashflow';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    requirePermission(auth.user, 'fin.read');
    const period = req.nextUrl.searchParams.get('period') ?? new Date().toISOString().slice(0, 7);
    return ok(await getCashFlow(period));
  } catch (e) {
    return handleError(e);
  }
}
