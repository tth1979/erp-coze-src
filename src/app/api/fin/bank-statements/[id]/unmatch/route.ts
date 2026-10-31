import { NextRequest } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { unmatchStatement, DEFAULT_BANK_ACCOUNT, getReconciliation } from '@/server/finance/bank';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.write');
    const { id } = await ctx.params;
    await unmatchStatement(id);
    return ok(await getReconciliation(DEFAULT_BANK_ACCOUNT));
  } catch (error) {
    return handleError(error);
  }
}
