import { NextRequest, NextResponse } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { parseListQuery } from '@/server/master-data/helpers';
import { createDictType, listTypes, type DictTypeInput } from '@/server/dict/dict';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { user } = await requireAuth(request);
    return ok(await listTypes(parseListQuery(request.nextUrl.searchParams)));
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.write');
    const body = (await request.json()) as DictTypeInput;
    return ok(await createDictType(body), 201);
  } catch (error) {
    return handleError(error);
  }
}