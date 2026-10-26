import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { parseListQuery } from '@/server/master-data/helpers';
import { createReceipt, listPayments, receiptCreateSchema } from '@/server/finance/payments';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.read');
    const query = parseListQuery(request.nextUrl.searchParams);
    return ok(await listPayments({ ...query, direction: 'receipt' }));
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.write');
    const input = receiptCreateSchema.parse(await request.json());
    const created = await createReceipt(input, user.id);
    return ok(created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('FIN.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
