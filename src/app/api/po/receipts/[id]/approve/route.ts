import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { approveReceipt } from '@/server/purchase/receipts';

type RouteContext = { params: Promise<{ id: string }> };

/** 审核入库（终审通过即入库：库存 + 移动加权成本，单事务） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'po.approve');
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    return ok(await approveReceipt(id, user, body.comment));
  } catch (error) {
    return handleError(error);
  }
}
