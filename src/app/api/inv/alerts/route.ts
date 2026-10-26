import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { listAlerts } from '@/server/inventory/alerts';
import { parseListQuery } from '@/server/master-data/helpers';

/** 库存预警（跨仓可用合计 ≤ 安全库存阈值；safety_stock=0 不预警） */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.read');
    return ok(await listAlerts(parseListQuery(request.nextUrl.searchParams)));
  } catch (error) {
    return handleError(error);
  }
}
