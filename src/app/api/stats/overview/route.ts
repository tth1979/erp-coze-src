import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { financeSummary } from '@/server/finance/payments';
import { countAlerts } from '@/server/inventory/alerts';

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
    async function countStock(predicate?: 'out'): Promise<number> {
      const client = getSupabaseClient();
      let query = client.from('inv_stock').select('*', { count: 'exact', head: true });
      if (predicate === 'out') query = query.lte('quantity', 0);
      const { count, error } = await query;
      if (error) throw new Error(`统计 inv_stock 失败: ${error.message}`);
      return count ?? 0;
    }

    const [
      customers,
      suppliers,
      products,
      poTotal,
      poDraft,
      poPending,
      poApproved,
      soTotal,
      soDraft,
      soPending,
      soApproved,
      soShipped,
      stockKinds,
      stockOut,
      finance,
      alertCount,
    ] = await Promise.all([
      countRows('md_customers'),
      countRows('md_suppliers'),
      countRows('md_products'),
      countRows('po_purchase_orders'),
      countRows('po_purchase_orders', 'draft'),
      countRows('po_purchase_orders', 'pending'),
      countRows('po_purchase_orders', 'approved'),
      countRows('so_sales_orders'),
      countRows('so_sales_orders', 'draft'),
      countRows('so_sales_orders', 'pending'),
      countRows('so_sales_orders', 'approved'),
      countRows('so_sales_orders', 'shipped'),
      countStock(),
      countStock('out'),
      financeSummary(),
      countAlerts(),
    ]);
    return ok({
      customers,
      suppliers,
      products,
      purchase_orders: { total: poTotal, draft: poDraft, pending: poPending, approved: poApproved },
      sales_orders: { total: soTotal, draft: soDraft, pending: soPending, approved: soApproved, shipped: soShipped },
      inventory: { tracked_kinds: stockKinds, out_of_stock: stockOut, alerts: alertCount },
      finance,
    });
  } catch (error) {
    return handleError(error);
  }
}
