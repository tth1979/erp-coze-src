import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { listStock } from '@/server/inventory/stock';
import { parseListQuery } from '@/server/master-data/helpers';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.read');
    const query = parseListQuery(request.nextUrl.searchParams);
    return ok(await listStock(query));
  } catch (error) {
    return handleError(error);
  }
}
