import { NextRequest } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { approveExpense } from '@/server/finance/expenses';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.write');
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({} as { comment?: string }));
    return ok(await approveExpense(id, user, body?.comment));
  } catch (error) {
    return handleError(error);
  }
}
