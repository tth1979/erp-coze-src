import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fail, handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { runDepreciation } from '@/server/finance/fixed-assets';

const runSchema = z.object({
  period: z.string().regex(/^\d{4}-\d{2}$/, '期间格式应为 YYYY-MM'),
});

/** POST /api/fin/depreciation/run  执行某期间月度计提（幂等） */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.write');
    const { period } = runSchema.parse(await req.json());
    return ok(await runDepreciation(period, user));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('FIN.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
