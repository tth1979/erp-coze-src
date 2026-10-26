import { NextRequest } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';

async function countRows(table: string): Promise<number> {
  const client = getSupabaseClient();
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true });
  if (error) throw new Error(`统计 ${table} 失败: ${error.message}`);
  return count ?? 0;
}

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'dashboard.read');
    const [customers, suppliers, products] = await Promise.all([
      countRows('md_customers'),
      countRows('md_suppliers'),
      countRows('md_products'),
    ]);
    return ok({ customers, suppliers, products });
  } catch (error) {
    return handleError(error);
  }
}
