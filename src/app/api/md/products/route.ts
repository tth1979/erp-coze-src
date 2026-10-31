import { NextRequest } from 'next/server';
import { z } from 'zod';
import { effectivePermissionsOf, requireAuth, requirePermission } from '@/server/auth/guard';
import { maskSensitiveFields } from '@/server/auth/permissions';
import { fail, handleError, ok } from '@/server/http';
import { parseListQuery } from '@/server/master-data/helpers';
import { createProduct, listProducts } from '@/server/master-data/products';

const createSchema = z.object({
  sku_code: z.string().trim().min(1, '商品编码不能为空').max(32),
  name: z.string().trim().min(1, '商品名称不能为空').max(128),
  model: z.string().trim().max(64).nullish(),
  spec: z.string().trim().max(64).nullish(),
  unit: z.string().trim().max(16).optional(),
  barcode: z.string().trim().max(64).nullish(),
  category: z.string().trim().max(64).nullish(),
  brand: z.string().trim().max(64).nullish(),
  color: z.string().trim().max(64).nullish(),
  pieces_per_box: z.number().int().min(0).nullish(),
  area_per_box: z.number().min(0).nullish(),
  reference_purchase_price: z.number().min(0).nullish(),
  reference_sale_price: z.number().min(0).nullish(),
  safety_stock: z.number().min(0).nullish(),
  tax_rate: z.number().min(0).nullish(),
  status: z.enum(['active', 'disabled']).optional(),
  remark: z.string().max(2000).nullish(),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.read');
    const result = await listProducts(parseListQuery(request.nextUrl.searchParams));
    // 字段级权限：无 field.cost_price 时成本价置 null
    return ok({ ...result, items: maskSensitiveFields(result.items, effectivePermissionsOf(user)) });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.write');
    const input = createSchema.parse(await request.json());
    const created = await createProduct(input);
    return ok(created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('MD.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
