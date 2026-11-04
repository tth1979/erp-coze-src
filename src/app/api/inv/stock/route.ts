import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { listStock } from '@/server/inventory/stock';
import { parseListQuery } from '@/server/master-data/helpers';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.read');
    const params = request.nextUrl.searchParams;
    const query = parseListQuery(params);
    const warehouseId = (params.get('warehouse_id') ?? '').trim() || undefined;
    const colorCode = (params.get('color_code') ?? '').trim() || undefined;
    return ok(await listStock({ ...query, warehouse_id: warehouseId, color_code: colorCode }));
  } catch (error) {
    return handleError(error);
  }
}
