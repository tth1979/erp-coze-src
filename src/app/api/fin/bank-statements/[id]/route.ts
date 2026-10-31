import { NextRequest } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { deleteBankStatement } from '@/server/finance/bank';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.write');
    const { id } = await ctx.params;
    await deleteBankStatement(id);
    return ok({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
