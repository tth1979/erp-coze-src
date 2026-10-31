import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fail, handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { getFixedAssetDetail, updateFixedAsset, deleteFixedAsset, type FixedAssetInput } from '@/server/finance/fixed-assets';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.read');
    const { id } = await ctx.params;
    return ok(await getFixedAssetDetail(id));
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.write');
    const { id } = await ctx.params;
    const body = (await req.json()) as Partial<FixedAssetInput>;
    return ok(await updateFixedAsset(id, body, user));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('FIN.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.write');
    const { id } = await ctx.params;
    await deleteFixedAsset(id, user);
    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
