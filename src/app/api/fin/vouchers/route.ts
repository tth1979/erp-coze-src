import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { listVouchers, createManualDraftVoucher } from '@/server/ledger/ledger';

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
      period: sp.get('period') ?? undefined,
      account_code: sp.get('account_code') ?? undefined,
    });
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}

/** 手工记账凭证（草稿）：录入借贷分录，先建草稿待过账 */
export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.write');
    const body = await request.json();
    const result = await createManualDraftVoucher(body, { id: user.id });
    return ok(result, 201);
  } catch (error) {
    return handleError(error);
  }
}