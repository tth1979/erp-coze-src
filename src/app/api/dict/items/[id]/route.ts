import { NextRequest, NextResponse } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { removeDictItem, updateDictItem, type DictItemInput } from '@/server/dict/dict';

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.write');
    const { id } = await context.params;
    const body = (await request.json()) as DictItemInput;
    return ok(await updateDictItem(id, body));
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.write');
    const { id } = await context.params;
    await removeDictItem(id);
    return ok({ success: true });
  } catch (error) {
    return handleError(error);
  }
}