import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { approveRequisition } from '@/server/purchase/requisitions';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'po.approve');
    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { comment?: string };
    return ok(await approveRequisition(id, user, body.comment));
  } catch (error) {
    return handleError(error);
  }
}
