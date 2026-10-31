import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fail, handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { listDepreciationRecords } from '@/server/finance/fixed-assets';
import { parseListQuery } from '@/server/master-data/helpers';

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.read');
    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params);
    const result = await listDepreciationRecords(query, {
      period: params.get('period') || undefined,
      asset_id: params.get('asset_id') || undefined,
    });
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}
