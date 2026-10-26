import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { cancelCheck } from '@/server/inventory/checks';

type RouteContext = { params: Promise<{ id: string }> };

/** 关闭盘点单（draft/pending/rejected → closed） */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'inv.write');
    const { id } = await context.params;
    return ok(await cancelCheck(id, user));
  } catch (error) {
    return handleError(error);
  }
}
