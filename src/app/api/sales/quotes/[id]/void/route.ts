import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { quoteVoidSchema, voidQuote } from '@/server/sales/quotes';

type RouteContext = { params: Promise<{ id: string }> };

/** 作废报价单（带原因；作废后不可转订单） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const { id } = await context.params;
    const { reason } = quoteVoidSchema.parse(await request.json());
    return ok(await voidQuote(id, reason));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('SO.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
