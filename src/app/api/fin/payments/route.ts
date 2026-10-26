import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { parseListQuery } from '@/server/master-data/helpers';
import { createPayment, listPayments, paymentCreateSchema, type PaymentDirection } from '@/server/finance/payments';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.read');
    const query = parseListQuery(request.nextUrl.searchParams);
    const raw = request.nextUrl.searchParams.get('direction');
    const direction: PaymentDirection | undefined =
      raw === 'receipt' || raw === 'payment' ? raw : undefined;
    return ok(await listPayments({ ...query, direction }));
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.write');
    const input = paymentCreateSchema.parse(await request.json());
    const created = await createPayment(input, user.id);
    return ok(created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('FIN.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
