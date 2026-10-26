import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { reverseReceipt, receiptReverseSchema } from '@/server/purchase/receipts';

type RouteContext = { params: Promise<{ id: string }> };

/** 暂估冲回：红字冲销原暂估 + 按发票蓝字重入（单事务，对账平衡） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'po.write');
    const { id } = await context.params;
    const input = receiptReverseSchema.parse(await request.json());
    return ok(await reverseReceipt(id, input, user));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('PO.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
