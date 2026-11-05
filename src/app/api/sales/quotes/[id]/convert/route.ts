import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { convertQuote } from '@/server/sales/quotes';

type RouteContext = { params: Promise<{ id: string }> };

const convertSchema = z.object({
  /** 信用超限强制通过原因（需 so.approve 权限，落审计）；force 与 reason 为别名 */
  force_reason: z.string().max(200, '强制通过原因不能超过 200 字').nullish(),
  force: z.boolean().nullish(),
  reason: z.string().max(200, '强制通过原因不能超过 200 字').nullish(),
});

/** 报价转销售订单：生成 draft 订单并回写 quote_id，状态 → converted（含信用校验） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user, permissions } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const { id } = await context.params;
    let forceReason: string | null = null;
    const raw = await request.text();
    if (raw.trim()) {
      const parsed = convertSchema.parse(JSON.parse(raw));
      forceReason = parsed.force_reason ?? parsed.reason ?? null;
    }
    return ok(
      await convertQuote(id, {
        operatorId: user.id,
        operatorName: user.username,
        permissions,
        forceReason,
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
