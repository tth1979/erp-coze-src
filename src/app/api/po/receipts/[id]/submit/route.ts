import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { submitReceipt } from '@/server/purchase/receipts';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'po.write');
    const { id } = await context.params;
    return ok(await submitReceipt(id, user));
  } catch (error) {
    return handleError(error);
  }
}
