import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { closeManufacturing } from '@/server/processing/processing';
import { handleError } from '@/server/http';

/** POST /api/ma/orders/[id]/close 关闭（draft/pending/rejected） */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    await requirePermission(user, 'ma.write');
    const { id } = await ctx.params;
    await closeManufacturing(id, user);
    return NextResponse.json({ success: true });
  } catch (error) {
    return handleError(error);
  }
}