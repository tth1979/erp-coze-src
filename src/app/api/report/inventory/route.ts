import { NextRequest, NextResponse } from 'next/server';
import { handleError } from '@/server/http';
import { requireAuth } from '@/server/auth/guard';
import { buildInventoryReport } from '@/server/reporting/inventory';
import { parseGroupBy } from '@/server/reporting/parse';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAuth(request);
    const groupBy = parseGroupBy(request.nextUrl.searchParams, 'warehouse', ['warehouse', 'product']);
    const data = await buildInventoryReport(groupBy, request.nextUrl.searchParams);
    return NextResponse.json({ items: data });
  } catch (error) {
    return handleError(error);
  }
}