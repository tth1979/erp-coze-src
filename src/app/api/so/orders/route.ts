import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { parseListQuery } from '@/server/master-data/helpers';
import { createOrder, listOrders, orderUpsertSchema } from '@/server/sales/orders';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.read');
    const query = parseListQuery(request.nextUrl.searchParams);
    const status = request.nextUrl.searchParams.get('status') ?? undefined;
    return ok(await listOrders({ ...query, status }));
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const input = orderUpsertSchema.parse(await request.json());
    const created = await createOrder(input, user.id);
    return ok(created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('SO.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
