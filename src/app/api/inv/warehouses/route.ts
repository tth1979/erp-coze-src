import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { createWarehouse, listWarehouses } from '@/server/inventory/warehouses';

/** 仓库列表（含停用，供单据与筛选下拉） */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.read');
    return ok({ items: await listWarehouses() });
  } catch (error) {
    return handleError(error);
  }
}

/** 新增仓库 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.write');
    return ok(await createWarehouse(await request.json()));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('INV.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
