import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { parseListQuery } from '@/server/master-data/helpers';
import { createReturn, listReturns, returnCreateSchema } from '@/server/sales/returns';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.read');
    const query = parseListQuery(request.nextUrl.searchParams);
    const status = request.nextUrl.searchParams.get('status') ?? undefined;
    return ok(await listReturns({ ...query, status }));
  } catch (error) {
    return handleError(error);
  }
}

/** 新建退货单（要求订单 shipped/approved；明细成本单价快照当前移动加权均价） */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const input = returnCreateSchema.parse(await request.json());
    const created = await createReturn(input, user);
    return ok(created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('SO.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
