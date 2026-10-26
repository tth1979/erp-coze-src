import { NextRequest, NextResponse } from 'next/server';
import { handleError } from '@/server/http';
import { requireAuth } from '@/server/auth/guard';
import { buildSalesReport } from '@/server/reporting/sales';
import { parseGroupBy } from '@/server/reporting/parse';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAuth(request);
    const groupBy = parseGroupBy(request.nextUrl.searchParams, 'customer', ['customer', 'product', 'month']);
    const data = await buildSalesReport(groupBy, request.nextUrl.searchParams);
    return NextResponse.json({ items: data });
  } catch (error) {
    return handleError(error);
  }
}