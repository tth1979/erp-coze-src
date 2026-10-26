import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { listVouchers } from '@/server/ledger/ledger';

/** 记账凭证分页列表 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.read');
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize')) || 20));
    const result = await listVouchers({
      page,
      page_size: pageSize,
      keyword: sp.get('keyword') ?? '',
      status: sp.get('status') ?? undefined,
      event_type: sp.get('event_type') ?? undefined,
      from: sp.get('from') ?? undefined,
      to: sp.get('to') ?? undefined,
    });
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}