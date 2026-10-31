import { NextRequest } from 'next/server';
import { fail, handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { markInvoice } from '@/server/tax/invoices';

/** POST /api/tax/invoices/[id]/mark  勾选认证/标记申报/作废 { status } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'tax.write');
    const { id } = await params;
    const body = (await req.json()) as { status?: string };
    if (!body.status) return fail('TAX.BAD_STATUS', '缺少目标状态', 400);
    return ok(await markInvoice(id, body.status));
  } catch (error) {
    return handleError(error);
  }
}
