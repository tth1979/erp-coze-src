import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { deleteReturn, getReturn } from '@/server/sales/returns';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.read');
    const { id } = await context.params;
    return ok(await getReturn(id));
  } catch (error) {
    return handleError(error);
  }
}

/** 删除退货单（仅 draft/rejected） */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const { id } = await context.params;
    await deleteReturn(id);
    return ok({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
