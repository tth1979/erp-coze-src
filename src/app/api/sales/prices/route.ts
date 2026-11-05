import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { parseListQuery } from '@/server/master-data/helpers';
import { createPriceStrategy, listPriceStrategies, priceStrategySchema } from '@/server/sales/prices';

/** 价格策略分页列表 / 新增 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.read');
    const sp = request.nextUrl.searchParams;
    return ok(
      await listPriceStrategies({
        ...parseListQuery(sp),
        scope_type: sp.get('scope_type') ?? undefined,
        status: sp.get('status') ?? undefined,
      }),
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const input = priceStrategySchema.parse(await request.json());
    return ok(await createPriceStrategy(input, user.id), 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('SO.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
