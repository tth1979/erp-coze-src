import { NextRequest } from 'next/server';
import { z } from 'zod';
import { dataScopeOf, requireAuth, requirePermission } from '@/server/auth/guard';
import { dataScopeUserIds } from '@/server/auth/permissions';
import { fail, handleError, ok } from '@/server/http';
import { parseListQuery } from '@/server/master-data/helpers';
import { createOrder, listOrders, orderUpsertSchema } from '@/server/purchase/orders';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'po.read');
    const query = parseListQuery(request.nextUrl.searchParams);
    const status = request.nextUrl.searchParams.get('status') ?? undefined;
    // 数据级权限：dept/self 范围限定可见操作人
    const createdByIds = await dataScopeUserIds(user, dataScopeOf(user));
    return ok(await listOrders({ ...query, status, createdByIds }));
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'po.write');
    const input = orderUpsertSchema.parse(await request.json());
    const created = await createOrder(input, user.id);
    return ok(created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('PO.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
