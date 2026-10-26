import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { approveShipment } from '@/server/sales/shipments';

type RouteContext = { params: Promise<{ id: string }> };

/** 审批通过（终审 = 出库：plpgsql 单事务扣库存 + 移动加权成本结转） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.approve');
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    return ok(await approveShipment(id, user, body.comment));
  } catch (error) {
    return handleError(error);
  }
}
