import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { submitCheck } from '@/server/inventory/checks';

type RouteContext = { params: Promise<{ id: string }> };

/** 提交盘点单进入审批（draft/rejected → pending；要求账面明细非空） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.write');
    const { id } = await context.params;
    return ok(await submitCheck(id, user));
  } catch (error) {
    return handleError(error);
  }
}
