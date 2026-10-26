import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { getVoucher, deleteVoucher } from '@/server/ledger/ledger';

/** 凭证详情（含分录） */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.read');
    const { id } = await ctx.params;
    return ok(await getVoucher(id));
  } catch (error) {
    return handleError(error);
  }
}

/** 删除凭证（仅未过账 draft 可删，已过账走红字冲销） */
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.write');
    const { id } = await ctx.params;
    await deleteVoucher(id);
    return ok({ deleted: true });
  } catch (error) {
    if (error instanceof SyntaxError) return fail('FIN.BAD_REQUEST', '请求参数错误', 400);
    return handleError(error);
  }
}