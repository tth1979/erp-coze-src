import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { listArBills } from '@/server/finance/payments';

/** 应收单列表（已出库销售订单物化，含核销明细） */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.read');
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize')) || 20));
    const s = sp.get('status');
    const status: 'settled' | 'open' | undefined = s === 'settled' || s === 'open' ? s : undefined;
    const keyword = sp.get('keyword') ?? '';
    const result = await listArBills({ page, pageSize, keyword, status });
    return ok(result);
  } catch (error) {
    if (error instanceof SyntaxError) return fail('FIN.BAD_REQUEST', '请求参数错误', 400);
    return handleError(error);
  }
}