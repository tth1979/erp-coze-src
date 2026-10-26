import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { rejectOrder } from '@/server/purchase/orders';

type RouteContext = { params: Promise<{ id: string }> };

const rejectSchema = z.object({ reason: z.string().min(1, '请填写驳回原因').max(500) });

/** 驳回当前审批步骤（单据 → rejected，可编辑后重新提交） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'po.approve');
    const { id } = await context.params;
    const { reason } = rejectSchema.parse(await request.json());
    return ok(await rejectOrder(id, user, reason));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('PO.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
