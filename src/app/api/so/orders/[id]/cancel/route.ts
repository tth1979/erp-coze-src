import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { cancelOrder } from '@/server/sales/orders';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const { id } = await context.params;
    return ok(await cancelOrder(id));
  } catch (error) {
    return handleError(error);
  }
}
