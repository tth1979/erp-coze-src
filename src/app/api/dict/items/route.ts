import { NextRequest, NextResponse } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { createDictItem, listItems, type DictItemInput } from '@/server/dict/dict';
import { parseListQuery } from '@/server/master-data/helpers';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAuth(request);
    const q = parseListQuery(request.nextUrl.searchParams);
    const items = await listItems({ ...q, type_code: request.nextUrl.searchParams.get('type') ?? undefined });
    return ok(items);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.write');
    const body = (await request.json()) as DictItemInput;
    return ok(await createDictItem(body), 201);
  } catch (error) {
    return handleError(error);
  }
}