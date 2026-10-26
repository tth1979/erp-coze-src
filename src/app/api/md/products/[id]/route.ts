import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { deleteProduct, getProduct, updateProduct } from '@/server/master-data/products';

const updateSchema = z.object({
  sku_code: z.string().trim().min(1).max(32).optional(),
  name: z.string().trim().min(1).max(128).optional(),
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
  status: z.enum(['active', 'disabled']).optional(),
  remark: z.string().max(2000).nullish(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.read');
    const { id } = await context.params;
    return ok(await getProduct(id));
  } catch (error) {
    return handleError(error);
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.write');
    const { id } = await context.params;
    const input = updateSchema.parse(await request.json());
    return ok(await updateProduct(id, input));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('MD.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.write');
    const { id } = await context.params;
    await deleteProduct(id);
    return ok({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
