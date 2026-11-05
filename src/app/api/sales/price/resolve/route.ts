import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { resolvePrice } from '@/server/sales/prices';

const uuidRe = /^[0-9a-fA-F-]{36}$/;

/** 售价试算：三档取优（客户+SKU > 客户等级 > 全局），再按数量命中阶梯 */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.read');
    const sp = request.nextUrl.searchParams;
    const customerId = sp.get('customer_id') ?? '';
    const productId = sp.get('product_id') ?? '';
    const qty = Number(sp.get('quantity') ?? sp.get('qty') ?? '1');
    if (!uuidRe.test(customerId) || !uuidRe.test(productId)) {
      return fail('SO.BAD_REQUEST', 'customer_id 与 product_id 必填且为合法 ID', 400);
    }
    if (!Number.isFinite(qty) || qty <= 0 || qty > 9_999_999) {
      return fail('SO.BAD_REQUEST', 'qty 必须为大于 0 的数字', 400);
    }
    return ok(await resolvePrice(customerId, productId, qty));
  } catch (error) {
    return handleError(error);
  }
}
