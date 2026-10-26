import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError } from '@/server/http';
import { rejectManufacturing } from '@/server/processing/processing';

/** POST /api/ma/orders/[id]/reject 驳回当前步 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    await requirePermission(user, 'ma.approve');
    const { id } = await ctx.params;
    const body = await req.json().catch(() => null);
    const reason = body?.reason ?? '';
    await rejectManufacturing(id, user, reason);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}