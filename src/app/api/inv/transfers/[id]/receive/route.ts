import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { receiveTransfer } from '@/server/inventory/transfers';

type RouteContext = { params: Promise<{ id: string }> };

/** 调拨收货（approved → received；调入仓在途转现有，单事务） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.write');
    const { id } = await context.params;
    return ok(await receiveTransfer(id, user));
  } catch (error) {
    return handleError(error);
  }
}
