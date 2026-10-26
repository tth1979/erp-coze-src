import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { ApiError, handleError } from '@/server/http';
import { issueManufacturing } from '@/server/processing/processing';

/** POST /api/ma/orders/[id]/issue 分批领料 {warehouse_id, items:[{product_id,quantity}]} */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    await requirePermission(user, 'ma.write');
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    if (!body?.warehouse_id || !Array.isArray(body.items)) {
      throw new ApiError(400, 'MA.BAD_PARAM', '缺少 warehouse_id 或 items');
    }
    const res = await issueManufacturing(id, body.warehouse_id, body.items, user);
    return NextResponse.json(res);
  } catch (error) {
    return handleError(error);
  }
}