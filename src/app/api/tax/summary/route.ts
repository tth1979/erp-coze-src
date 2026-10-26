import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { listTaxSummary } from '@/server/tax/tax';

/** 税额统计表（按期间×税率汇总销项/进项） */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.read');
    const result = await listTaxSummary();
    return ok({ items: result });
  } catch (error) {
    return handleError(error);
  }
}