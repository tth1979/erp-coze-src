import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { getClosePeriods } from '@/server/finance/period-close';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    requirePermission(auth.user, 'fin.read');
    return ok(await getClosePeriods());
  } catch (e) {
    return handleError(e);
  }
}