import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { postVoucher } from '@/server/ledger/ledger';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.write');
    const { id } = await ctx.params;
    return ok(await postVoucher(id, { id: user.id }));
  } catch (error) {
    return handleError(error);
  }
}