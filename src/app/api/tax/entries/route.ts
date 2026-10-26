import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { listTaxEntries } from '@/server/tax/tax';

/** 税额登记列表（销项/进项），可按类型/期间过滤 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'fin.read');
    const sp = request.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get('page')) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize')) || 20));
    const result = await listTaxEntries({
      page,
      page_size: pageSize,
      tax_type: sp.get('tax_type') ?? undefined,
      period: sp.get('period') ?? undefined,
      keyword: sp.get('keyword') ?? '',
    });
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}