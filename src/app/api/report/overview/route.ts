import { NextRequest, NextResponse } from 'next/server';
import { fail, handleError } from '@/server/http';
import { requireAuth } from '@/server/auth/guard';
import { buildOverviewReport } from '@/server/reporting/overview';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAuth(request);
    const data = await buildOverviewReport();
    return NextResponse.json(data);
  } catch (error) {
    return handleError(error);
  }
}