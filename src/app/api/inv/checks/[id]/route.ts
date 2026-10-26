import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { deleteCheck, getCheck, updateCheck } from '@/server/inventory/checks';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.read');
    const { id } = await context.params;
    return ok(await getCheck(id));
  } catch (error) {
    return handleError(error);
  }
}

/** 更新盘点单（仅 draft/rejected；可改备注与实盘数） */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.write');
    const { id } = await context.params;
    return ok(await updateCheck(id, await request.json()));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('INV.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}

/** 删除盘点单（仅 draft） */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.write');
    const { id } = await context.params;
    await deleteCheck(id);
    return ok({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
