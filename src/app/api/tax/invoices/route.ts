import { NextRequest } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { listInvoices, createInvoice, type InvoiceInput } from '@/server/tax/invoices';

/** GET /api/tax/invoices  发票台账分页（关键字/类型/方向/状态/期间） */
export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'tax.read');
    const sp = req.nextUrl.searchParams;
    const result = await listInvoices({
      page: Number(sp.get('page')) || 1,
      pageSize: Number(sp.get('pageSize')) || 20,
      keyword: sp.get('keyword') || '',
      invoice_type: sp.get('invoice_type') || undefined,
      direction: sp.get('direction') || undefined,
      status: sp.get('status') || undefined,
      period: sp.get('period') || undefined,
    });
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}

/** POST /api/tax/invoices  录入发票 */
export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'tax.write');
    const body = (await req.json()) as InvoiceInput;
    const result = await createInvoice(body, user.id);
    return ok(result, 201);
  } catch (error) {
    return handleError(error);
  }
}
