import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fail, handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { autoMatch, DEFAULT_BANK_ACCOUNT } from '@/server/finance/bank';

const schema = z.object({ account: z.string().trim().max(64).optional() });

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.write');
    const body = await req.json().catch(() => ({}));
    const { account } = schema.parse(body ?? {});
    return ok(await autoMatch(account || DEFAULT_BANK_ACCOUNT));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('FIN.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
