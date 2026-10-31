import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { yearClose } from '@/server/finance/period-close';

export async function POST(req: NextRequest, ctx: { params: Promise<{ period: string }> }) {
  try {
    const auth = await requireAuth(req);
    requirePermission(auth.user, 'fin.write');
    const { period } = await ctx.params; // 取年份前 4 位
    return ok(await yearClose(period.slice(0, 4), auth.user.id));
  } catch (e) {
    return handleError(e);
  }
}