import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { creditBoard } from '@/server/sales/credit';

/** 客户信用看板：每客户一行（额度/已用/可用/逾期金额/最长逾期天数/绿黄红） */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.read');
    const keyword = (request.nextUrl.searchParams.get('keyword') ?? '').trim();
    return ok(await creditBoard(keyword || undefined));
  } catch (error) {
    return handleError(error);
  }
}
