import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { approveOrder } from '@/server/purchase/orders';

type RouteContext = { params: Promise<{ id: string }> };

/** 审批通过当前步骤（终审后订单 → approved） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'po.approve');
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    return ok(await approveOrder(id, user, body.comment));
  } catch (error) {
    return handleError(error);
  }
}
