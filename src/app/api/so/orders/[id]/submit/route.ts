import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { submitOrder } from '@/server/sales/orders';

type RouteContext = { params: Promise<{ id: string }> };

/** 提交审批（draft/rejected → pending，按金额命中审批规则级别） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const { id } = await context.params;
    return ok(await submitOrder(id, user));
  } catch (error) {
    return handleError(error);
  }
}
