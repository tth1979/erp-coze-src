import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { submitTransfer } from '@/server/inventory/transfers';

type RouteContext = { params: Promise<{ id: string }> };

/** 提交调拨单进入审批（draft/rejected → pending） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.write');
    const { id } = await context.params;
    return ok(await submitTransfer(id, user));
  } catch (error) {
    return handleError(error);
  }
}
