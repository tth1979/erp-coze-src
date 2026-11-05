import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { acceptQuote } from '@/server/sales/quotes';

type RouteContext = { params: Promise<{ id: string }> };

/** 客户接受：sent → accepted */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.write');
    const { id } = await context.params;
    return ok(await acceptQuote(id));
  } catch (error) {
    return handleError(error);
  }
}
