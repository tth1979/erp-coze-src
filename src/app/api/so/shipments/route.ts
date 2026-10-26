import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { parseListQuery } from '@/server/master-data/helpers';
import { createShipment, listShipments, shipmentCreateSchema } from '@/server/sales/shipments';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.read');
    const query = parseListQuery(request.nextUrl.searchParams);
    const status = request.nextUrl.searchParams.get('status') ?? undefined;
    return ok(await listShipments({ ...query, status }));
  } catch (error) {
    return handleError(error);
  }
}

/** 新建出库单（要求订单已审 approved；单价强制取订单锁定成交价） */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const input = shipmentCreateSchema.parse(await request.json());
    const created = await createShipment(input, user);
    return ok(created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('SO.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
