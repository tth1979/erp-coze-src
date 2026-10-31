import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fail, handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { payExpense } from '@/server/finance/expenses';

const schema = z.object({
  method: z.string().trim().max(16).optional(),
  paid_at: z.string().trim().optional(),
  remark: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.write');
    const { id } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    const input = schema.parse(body ?? {});
    return ok(await payExpense(id, user, input));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('FIN.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
