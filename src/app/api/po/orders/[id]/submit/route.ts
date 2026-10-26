import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { submitOrder } from '@/server/purchase/orders';

type RouteContext = { params: Promise<{ id: string }> };

/** 提交采购订单进入审批（draft/rejected → pending） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'po.write');
    const { id } = await context.params;
    return ok(await submitOrder(id, user));
  } catch (error) {
    return handleError(error);
  }
}
