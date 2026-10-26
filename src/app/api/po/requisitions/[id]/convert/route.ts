import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { convertRequisition, convertSchema } from '@/server/purchase/requisitions';

type RouteContext = { params: Promise<{ id: string }> };

/** 已审申请单转采购订单（生成 draft 订单，申请单 → closed） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'po.write');
    const { id } = await context.params;
    const input = convertSchema.parse(await request.json());
    return ok(await convertRequisition(id, input, user.id), 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('PO.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
