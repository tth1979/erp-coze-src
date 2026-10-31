import { NextRequest } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { getReconciliation, DEFAULT_BANK_ACCOUNT } from '@/server/finance/bank';

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.read');
    const account = req.nextUrl.searchParams.get('account') || DEFAULT_BANK_ACCOUNT;
    return ok(await getReconciliation(account));
  } catch (error) {
    return handleError(error);
  }
}
