import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { submitShipment } from '@/server/sales/shipments';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const { id } = await context.params;
    return ok(await submitShipment(id, user));
  } catch (error) {
    return handleError(error);
  }
}
