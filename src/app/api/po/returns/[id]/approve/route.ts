import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { approveReturn } from '@/server/purchase/returns';

type RouteContext = { params: Promise<{ id: string }> };

/** 审核退货（终审通过即出库；库存不足整单回滚 400） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'po.approve');
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    return ok(await approveReturn(id, user, body.comment));
  } catch (error) {
    return handleError(error);
  }
}
