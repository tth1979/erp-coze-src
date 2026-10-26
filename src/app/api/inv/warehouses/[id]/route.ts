import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { updateWarehouse } from '@/server/inventory/warehouses';

type RouteContext = { params: Promise<{ id: string }> };

/** 更新仓库（改名/地址/启停） */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.write');
    const { id } = await context.params;
    return ok(await updateWarehouse(id, await request.json()));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('INV.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
