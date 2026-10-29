import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError } from '@/server/http';
import { closePeriodCostTransfer } from '@/server/ledger/period-close';

/** POST /api/fin/vouchers/period-close  { period } 期末成本结转批处理（幂等） */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { user } = await requireAuth(req);
    if (user.role !== 'admin') requirePermission(user, 'fin.write');
    const body = (await req.json().catch(() => ({}))) as { period?: string };
    const period = body?.period?.trim();
    if (!period) return NextResponse.json({ code: 'TAX.BAD_PERIOD', message: '缺少期间参数' }, { status: 400 });
    const result = await closePeriodCostTransfer(period, user.id);
    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return handleError(e);
  }
}