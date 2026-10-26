import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { createTransfer, listTransfers } from '@/server/inventory/transfers';
import { parseListQuery } from '@/server/master-data/helpers';

/** 调拨单分页列表（status / from_warehouse_id / to_warehouse_id 过滤，keyword 匹配单号） */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.read');
    const params = request.nextUrl.searchParams;
    const query = parseListQuery(params);
    const status = (params.get('status') ?? '').trim() || undefined;
    const fromWarehouseId = (params.get('from_warehouse_id') ?? '').trim() || undefined;
    const toWarehouseId = (params.get('to_warehouse_id') ?? '').trim() || undefined;
    return ok(await listTransfers({ ...query, status, from_warehouse_id: fromWarehouseId, to_warehouse_id: toWarehouseId }));
  } catch (error) {
    return handleError(error);
  }
}

/** 新建调拨单（草稿） */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.write');
    return ok(await createTransfer(await request.json(), user));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('INV.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
