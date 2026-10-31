import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fail, handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { listFixedAssets, createFixedAsset, type FixedAssetInput } from '@/server/finance/fixed-assets';
import { parseListQuery } from '@/server/master-data/helpers';

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.read');
    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params);
    const result = await listFixedAssets(query, {
      category: params.get('category') || undefined,
      status: params.get('status') || undefined,
    });
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.write');
    const body = (await req.json()) as FixedAssetInput;
    const result = await createFixedAsset(body, user);
    return ok(result, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('FIN.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
