import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { deletePayment } from '@/server/finance/payments';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.write');
    const { id } = await context.params;
    await deletePayment(id, 'receipt');
    return ok({ id });
  } catch (error) {
    return handleError(error);
  }
}
