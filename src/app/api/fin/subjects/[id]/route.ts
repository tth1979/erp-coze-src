import { NextRequest } from 'next/server';
import { handleError, ok } from '@/server/http';
import { getSubject, updateSubject, removeSubject } from '@/server/finance/subjects';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import type { SubjectInput } from '@/server/finance/subjects';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(_req);
    requirePermission(auth.user, 'fin.read');
    const { id } = await ctx.params;
    return ok(await getSubject(id));
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    requirePermission(auth.user, 'fin.write');
    const { id } = await ctx.params;
    const body = (await req.json()) as SubjectInput;
    return ok(await updateSubject(id, body));
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(req);
    requirePermission(auth.user, 'fin.write');
    const { id } = await ctx.params;
    await removeSubject(id);
    return ok({ success: true });
  } catch (e) {
    return handleError(e);
  }
}