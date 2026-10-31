import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { closeProfit } from '@/server/finance/period-close';

export async function POST(req: NextRequest, ctx: { params: Promise<{ period: string }> }) {
  try {
    const auth = await requireAuth(req);
    requirePermission(auth.user, 'fin.write');
    const { period } = await ctx.params;
    const data = await closeProfit(period, auth.user.id);
    return ok(data ?? { skipped: true });
  } catch (e) {
    return handleError(e);
  }
}