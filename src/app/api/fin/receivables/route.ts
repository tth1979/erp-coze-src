import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { parseListQuery } from '@/server/master-data/helpers';
import { listReceivables } from '@/server/finance/payments';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.read');
    const query = parseListQuery(request.nextUrl.searchParams);
    return ok(await listReceivables(query));
  } catch (error) {
    return handleError(error);
  }
}
