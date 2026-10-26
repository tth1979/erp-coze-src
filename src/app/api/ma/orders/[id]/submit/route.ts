import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { submitManufacturing } from '@/server/processing/processing';
import { handleError } from '@/server/http';

/** POST /api/ma/orders/[id]/submit 提交审批 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    await requirePermission(user, 'ma.write');
    const { id } = await ctx.params;
    await submitManufacturing(id, user);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}