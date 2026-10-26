import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { rejectShipment } from '@/server/sales/shipments';

type RouteContext = { params: Promise<{ id: string }> };

const rejectSchema = z.object({ reason: z.string().min(1, '请填写驳回原因').max(500) });

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.approve');
    const { id } = await context.params;
    const { reason } = rejectSchema.parse(await request.json());
    return ok(await rejectShipment(id, user, reason));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('SO.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
