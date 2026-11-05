import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { submitOrder } from '@/server/sales/orders';

type RouteContext = { params: Promise<{ id: string }> };

const submitSchema = z.object({
  /** 信用超限强制通过原因（需 so.approve 权限，落审计）；force 与 reason 为别名 */
  force_reason: z.string().max(200, '强制通过原因不能超过 200 字').nullish(),
  force: z.boolean().nullish(),
  reason: z.string().max(200, '强制通过原因不能超过 200 字').nullish(),
});

/** 提交审批（draft/rejected → pending，按金额命中审批规则级别；确认前信用校验） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user, permissions } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const { id } = await context.params;
    let forceReason: string | null = null;
    const raw = await request.text();
    if (raw.trim()) {
      const parsed = submitSchema.parse(JSON.parse(raw));
      forceReason = parsed.force_reason ?? parsed.reason ?? null;
    }
    return ok(
      await submitOrder(id, user, {
        forceReason,
        permissions,
        ip: request.headers.get('x-forwarded-for'),
      }),
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('SO.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
