import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { deletePriceStrategy, getPriceStrategy, priceStrategySchema, updatePriceStrategy } from '@/server/sales/prices';

type RouteContext = { params: Promise<{ id: string }> };

/** 价格策略详情 / 更新 / 删除 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.read');
    const { id } = await context.params;
    return ok(await getPriceStrategy(id));
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const { id } = await context.params;
    const input = priceStrategySchema.parse(await request.json());
    return ok(await updatePriceStrategy(id, input));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('SO.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const { id } = await context.params;
    await deletePriceStrategy(id);
    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
