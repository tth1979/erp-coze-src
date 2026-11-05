import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { deleteQuote, getQuote, quoteUpsertSchema, updateQuote } from '@/server/sales/quotes';

type RouteContext = { params: Promise<{ id: string }> };

/** 报价单详情（含明细） / 更新（仅 draft） / 删除（仅 draft） */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.read');
    const { id } = await context.params;
    return ok(await getQuote(id));
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const { id } = await context.params;
    const input = quoteUpsertSchema.parse(await request.json());
    return ok(await updateQuote(id, input));
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
    await deleteQuote(id);
    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
