import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { reversePeriod } from '@/server/finance/period-close';

export async function POST(req: NextRequest, ctx: { params: Promise<{ period: string }> }) {
  try {
    const auth = await requireAuth(req);
    requirePermission(auth.user, 'fin.write');
    const { period } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { reason?: string };
    return ok(await reversePeriod(period, auth.user.id, body.reason ?? ''));
  } catch (e) {
    return handleError(e);
  }
}