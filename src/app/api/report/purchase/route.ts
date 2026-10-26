import { NextRequest, NextResponse } from 'next/server';
import { handleError } from '@/server/http';
import { requireAuth } from '@/server/auth/guard';
import { buildPurchaseReport } from '@/server/reporting/purchase';
import { parseGroupBy } from '@/server/reporting/parse';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAuth(request);
    const groupBy = parseGroupBy(request.nextUrl.searchParams, 'supplier', ['supplier', 'month']);
    const data = await buildPurchaseReport(groupBy, request.nextUrl.searchParams);
    return NextResponse.json({ items: data });
  } catch (error) {
    return handleError(error);
  }
}