import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { adjustFrozen } from '@/server/inventory/stock';

/** 冻结/解冻库存（delta 正冻结负解冻；可用量 = 现有 − 冻结，冻结不超现有） */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.write');
    return ok(await adjustFrozen(await request.json(), user.id));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('INV.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
