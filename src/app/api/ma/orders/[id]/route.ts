import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { ApiError, handleError } from '@/server/http';
import { getManufacturing, updateManufacturing, deleteManufacturing } from '@/server/processing/processing';

/** GET /api/ma/orders/[id] 加工单详情（含明细 + 审批步骤） */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    await requirePermission(user, 'ma.read');
    const { id } = await ctx.params;
    return NextResponse.json(await getManufacturing(id));
  } catch (error) {
    return handleError(error);
  }
}

/** PUT /api/ma/orders/[id] 更新（仅 draft/rejected） */
export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    await requirePermission(user, 'ma.write');
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    if (!body) throw new ApiError(400, 'MA.BAD_PARAM', '请求体为空');
    const order = await updateManufacturing(
      id,
      {
        processing_type: body.processing_type,
        loss_ratio: body.loss_ratio,
        items: body.items,
        remark: body.remark,
      },
      user,
    );
    return NextResponse.json(order);
  } catch (error) {
    return handleError(error);
  }
}

/** DELETE /api/ma/orders/[id] 删除（仅 draft） */
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    await requirePermission(user, 'ma.write');
    const { id } = await ctx.params;
    await deleteManufacturing(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}