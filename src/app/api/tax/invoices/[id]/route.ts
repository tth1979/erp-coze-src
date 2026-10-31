import { NextRequest } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { getInvoice, updateInvoice, deleteInvoice, type InvoiceInput } from '@/server/tax/invoices';

/** GET /api/tax/invoices/[id]  发票详情 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'tax.read');
    const { id } = await params;
    return ok(await getInvoice(id));
  } catch (error) {
    return handleError(error);
  }
}

/** PUT /api/tax/invoices/[id]  更新发票（已申报不可改） */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'tax.write');
    const { id } = await params;
    const body = (await req.json()) as Partial<InvoiceInput>;
    return ok(await updateInvoice(id, body));
  } catch (error) {
    return handleError(error);
  }
}

/** DELETE /api/tax/invoices/[id]  删除发票（已申报不可删） */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'tax.write');
    const { id } = await params;
    await deleteInvoice(id);
    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
