import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { listMovements } from '@/server/inventory/stock';
import { parseListQuery } from '@/server/master-data/helpers';

const MOVEMENT_TYPES = new Set(['in', 'out', 'adjust']);

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.read');
    const params = request.nextUrl.searchParams;
    const query = parseListQuery(params);
    const rawType = (params.get('type') ?? '').trim();
    const type = MOVEMENT_TYPES.has(rawType) ? rawType : undefined;
    const warehouseId = (params.get('warehouse_id') ?? '').trim() || undefined;
    return ok(await listMovements({ ...query, type, warehouse_id: warehouseId }));
  } catch (error) {
    return handleError(error);
  }
}
