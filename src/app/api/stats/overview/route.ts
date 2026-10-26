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
      poConfirmed,
      soTotal,
      soDraft,
      soConfirmed,
      stockKinds,
      stockOut,
    ] = await Promise.all([
      countRows('md_customers'),
      countRows('md_suppliers'),
      countRows('md_products'),
      countRows('po_purchase_orders'),
      countRows('po_purchase_orders', 'draft'),
      countRows('po_purchase_orders', 'confirmed'),
      countRows('so_sales_orders'),
      countRows('so_sales_orders', 'draft'),
      countRows('so_sales_orders', 'confirmed'),
      countStock(),
      countStock('out'),
    ]);
    return ok({
      customers,
      suppliers,
      products,
      purchase_orders: { total: poTotal, draft: poDraft, confirmed: poConfirmed },
      sales_orders: { total: soTotal, draft: soDraft, confirmed: soConfirmed },
      inventory: { tracked_kinds: stockKinds, out_of_stock: stockOut },
    });
  } catch (error) {
    return handleError(error);
  }
}
