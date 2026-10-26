import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { createCheck, listChecks } from '@/server/inventory/checks';
import { parseListQuery } from '@/server/master-data/helpers';

/** 盘点单分页列表（status / warehouse_id 过滤，keyword 匹配单号） */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.read');
    const params = request.nextUrl.searchParams;
    const query = parseListQuery(params);
    const status = (params.get('status') ?? '').trim() || undefined;
    const warehouseId = (params.get('warehouse_id') ?? '').trim() || undefined;
    return ok(await listChecks({ ...query, status, warehouse_id: warehouseId }));
  } catch (error) {
    return handleError(error);
  }
}

/** 新建盘点单（草稿；明细 = 该仓账面库存快照，counted_quantity 默认同账面） */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.write');
    return ok(await createCheck(await request.json(), user));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('INV.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
