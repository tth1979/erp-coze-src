import { NextRequest } from 'next/server';
import { handleError, ok } from '@/server/http';
import { getSubjectBalances } from '@/server/finance/subjects';
import { requireAuth, requirePermission } from '@/server/auth/guard';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    requirePermission(auth.user, 'fin.read');
    const period = req.nextUrl.searchParams.get('period') ?? '';
    return ok(await getSubjectBalances(period));
  } catch (e) {
    return handleError(e);
  }
}