import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { parseListQuery } from '@/server/master-data/helpers';
import { createQuote, listQuotes, quoteUpsertSchema } from '@/server/sales/quotes';

/** 报价单分页列表（status/customer_id/keyword/date 筛选） / 新建（草稿） */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.read');
    const sp = request.nextUrl.searchParams;
    return ok(
      await listQuotes({
        ...parseListQuery(sp),
        status: sp.get('status') ?? undefined,
        customer_id: sp.get('customer_id') ?? undefined,
        date_from: sp.get('date_from') ?? undefined,
        date_to: sp.get('date_to') ?? undefined,
      }),
    );
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const input = quoteUpsertSchema.parse(await request.json());
    return ok(await createQuote(input, user.id, user.display_name ?? user.username), 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('SO.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
