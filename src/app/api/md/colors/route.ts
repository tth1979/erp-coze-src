import { NextRequest, NextResponse } from 'next/server';
import { ApiError, handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { colorUpsertSchema, createProductColor, listColors } from '@/server/master-data/colors';

/** GET /api/md/colors?product_id=a,b,c — 色号档案（可多商品逗号分隔；缺省全量） */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    await requireAuth(request);
    const raw = request.nextUrl.searchParams.get('product_id') ?? '';
    const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return ok({ items: await listColors(ids.length > 0 ? ids : undefined) });
  } catch (error) {
    return handleError(error);
  }
}

/** POST /api/md/colors — 新增色号 {product_id, color_code, color_name, is_active?, remark?} */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.write');
    const body = (await request.json()) as {
      product_id?: string;
      color_code?: string;
      color_name?: string;
      is_active?: boolean;
      remark?: string;
    };
    if (!body.product_id) throw new ApiError(400, 'MD.BAD_PARAM', 'product_id 必填');
    const parsed = colorUpsertSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, 'MD.BAD_PARAM', parsed.error.issues[0]?.message ?? '参数错误');
    }
    return ok(await createProductColor(body.product_id, parsed.data), 201);
  } catch (error) {
    return handleError(error);
  }
}
