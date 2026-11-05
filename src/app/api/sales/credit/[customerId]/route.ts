import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { customerCreditDetail } from '@/server/sales/credit';

type RouteContext = { params: Promise<{ customerId: string }> };

/** 客户信用下钻：额度汇总 + 应收明细（未结清单据、逾期天数） */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.read');
    const { customerId } = await context.params;
    return ok(await customerCreditDetail(customerId));
  } catch (error) {
    return handleError(error);
  }
}
