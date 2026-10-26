import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { approveReceipt } from '@/server/finance/payments';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/** 收款核销（审核通过，递减应收） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.write');
    const { id } = await context.params;
    return ok(await approveReceipt(id, user.id));
  } catch (error) {
    return handleError(error);
  }
}