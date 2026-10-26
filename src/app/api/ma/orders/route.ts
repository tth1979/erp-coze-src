import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { parseListQuery } from '@/server/master-data/helpers';
import { listManufacturing, createManufacturing, type MaListQuery } from '@/server/processing/processing';
import { ApiError, handleError } from '@/server/http';

/** GET /api/ma/orders?page&pageSize&keyword&status&processing_type */
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    await requirePermission(user, 'ma.read');
    const sp = req.nextUrl.searchParams;
    const base = parseListQuery(sp);
    const query: MaListQuery = {
      ...base,
      status: sp.get('status') ?? undefined,
      processing_type: sp.get('processing_type') ?? undefined,
    };
    const data = await listManufacturing(query);
    return NextResponse.json(data);
  } catch (error) {
    return handleError(error);
  }
}

/** POST /api/ma/orders 新建加工单（草稿） */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    await requirePermission(user, 'ma.write');
    const body = await req.json().catch(() => null);
    if (!body) throw new ApiError(400, 'MA.BAD_PARAM', '请求体为空');
    const order = await createManufacturing(
      {
        processing_type: body.processing_type,
        loss_ratio: body.loss_ratio,
        items: body.items,
        remark: body.remark,
      },
      user,
    );
    return NextResponse.json(order, { status: 201 });
  } catch (error) {
    return handleError(error);
  }
}