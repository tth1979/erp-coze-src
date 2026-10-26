import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { approveManufacturing } from '@/server/processing/processing';
import { handleError } from '@/server/http';

/** POST /api/ma/orders/[id]/approve 审批通过当前步 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    await requirePermission(user, 'ma.approve');
    const { id } = await ctx.params;
    await approveManufacturing(id, user);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}