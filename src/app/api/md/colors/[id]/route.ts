import { NextRequest, NextResponse } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { deleteProductColor, updateProductColor } from '@/server/master-data/colors';

/** PUT /api/md/colors/[id] — 更新色号（名称/启停状态/备注；编码不可改） */
export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.write');
    const { id } = await context.params;
    const body = (await request.json()) as {
      color_name?: string;
      status?: string;
      remark?: string;
    };
    return ok(await updateProductColor(id, body));
  } catch (error) {
    return handleError(error);
  }
}

/** DELETE /api/md/colors/[id] — 删除色号（仅未被单据/库存引用时） */
export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.write');
    const { id } = await context.params;
    await deleteProductColor(id);
    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
