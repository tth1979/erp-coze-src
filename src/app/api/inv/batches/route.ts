import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { listBatches } from '@/server/inventory/batches';
import { parseListQuery } from '@/server/master-data/helpers';

/** 库存批次分页（keyword 匹配商品名/编码/批号，warehouse_id 过滤，in_stock=1 仅看有结余） */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.read');
    const params = request.nextUrl.searchParams;
    const query = parseListQuery(params);
    const warehouseId = (params.get('warehouse_id') ?? '').trim() || undefined;
    const inStock = (params.get('in_stock') ?? '').trim();
    return ok(await listBatches({ ...query, warehouse_id: warehouseId, in_stock: inStock || undefined }));
  } catch (error) {
    return handleError(error);
  }
}
