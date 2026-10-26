import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { approveReturn } from '@/server/sales/returns';

type RouteContext = { params: Promise<{ id: string }> };

/** 审批通过（终审 = 退货入库：plpgsql 单事务按快照成本红字回补库存/成本） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.approve');
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    return ok(await approveReturn(id, user, body.comment));
  } catch (error) {
    return handleError(error);
  }
}
