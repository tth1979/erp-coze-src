import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fail, handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { disposeFixedAsset, type DisposeInput } from '@/server/finance/fixed-assets';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.write');
    const { id } = await ctx.params;
    const body = (await req.json()) as DisposeInput;
    return ok(await disposeFixedAsset(id, body, user));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('FIN.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
