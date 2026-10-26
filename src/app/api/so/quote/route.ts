import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { quotePrice } from '@/server/sales/orders';

/**
 * 销售报价建议：GET /api/so/quote?customer_id=xxx&product_id=yyy
 * 按客户等级折扣 × 商品基础售价返回建议成交价（编辑器预填，最终仍以服务端重算为准）。
 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.read');
    const customerId = request.nextUrl.searchParams.get('customer_id');
    const productId = request.nextUrl.searchParams.get('product_id');
    if (!customerId || !productId) {
      return fail('SO.BAD_REQUEST', '缺少 customer_id 或 product_id', 400);
    }
    return ok(await quotePrice(customerId, productId));
  } catch (error) {
    return handleError(error);
  }
}
