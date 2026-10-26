import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { voidVoucher } from '@/server/ledger/ledger';

/** 红字冲销作废凭证（仅财务角色可执行） */
export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.write');
    const { id } = await ctx.params;
    const body = await request.json().catch(() => ({}));
    const reason = typeof body.reason === 'string' ? body.reason : '';
    return ok(await voidVoucher(id, user, reason));
  } catch (error) {
    return handleError(error);
  }
}