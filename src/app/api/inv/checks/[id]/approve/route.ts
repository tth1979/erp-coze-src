import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { approveCheck } from '@/server/inventory/checks';

type RouteContext = { params: Promise<{ id: string }> };

const approveSchema = z.object({ comment: z.string().max(500).nullish() });

/** 审批通过当前步骤（终审 = 盘盈/盘亏差异过账台账，单事务） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.approve');
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const { comment } = approveSchema.parse(body ?? {});
    return ok(await approveCheck(id, user, comment ?? undefined));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('INV.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
