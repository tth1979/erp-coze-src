import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';

async function countRows(table: string, status?: string): Promise<number> {
  const client = getSupabaseClient();
  let query = client.from(table).select('*', { count: 'exact', head: true });
  if (status) query = query.eq('status', status);
  const { count, error } = await query;
  if (error) throw new Error(`统计 ${table} 失败: ${error.message}`);
  return count ?? 0;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'dashboard.read');
    const [customers, suppliers, products, poTotal, poDraft, poConfirmed] = await Promise.all([
      countRows('md_customers'),
      countRows('md_suppliers'),
      countRows('md_products'),
      countRows('po_purchase_orders'),
      countRows('po_purchase_orders', 'draft'),
      countRows('po_purchase_orders', 'confirmed'),
    ]);
    return ok({
      customers,
      suppliers,
      products,
      purchase_orders: { total: poTotal, draft: poDraft, confirmed: poConfirmed },
    });
  } catch (error) {
    return handleError(error);
  }
}
