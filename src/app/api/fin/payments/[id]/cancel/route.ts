import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { cancelPayment } from '@/server/finance/payments';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** 作废付款单（仅未核销 pending 可作废） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.write');
    const { id } = await context.params;
    return ok(await cancelPayment(id, user.id));
  } catch (error) {
    return handleError(error);
  }
}