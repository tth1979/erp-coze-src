import { NextRequest, NextResponse } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { removeDictType, updateDictType, getDictType, type DictTypeInput } from '@/server/dict/dict';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    await requireAuth(request);
    const { id } = await context.params;
    return ok(await getDictType(id));
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.write');
    const { id } = await context.params;
    const body = (await request.json()) as DictTypeInput;
    return ok(await updateDictType(id, body));
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.write');
    const { id } = await context.params;
    await removeDictType(id);
    return ok({ success: true });
  } catch (error) {
    return handleError(error);
  }
}