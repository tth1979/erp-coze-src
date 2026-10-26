import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { deleteCustomer, getCustomer, updateCustomer } from '@/server/master-data/customers';

const updateSchema = z.object({
  code: z.string().trim().min(1).max(32).optional(),
  name: z.string().trim().min(1).max(128).optional(),
  contact: z.string().trim().max(64).nullish(),
  phone: z.string().trim().max(32).nullish(),
  email: z.string().trim().email('邮箱格式不正确').max(128).nullish().or(z.literal('')),
  address: z.string().trim().max(256).nullish(),
  level: z.enum(['normal', 'vip', 'strategic']).optional(),
  tax_no: z.string().trim().max(64).nullish(),
  status: z.enum(['active', 'disabled']).optional(),
  remark: z.string().max(2000).nullish(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.read');
    const { id } = await context.params;
    return ok(await getCustomer(id));
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
    return ok(await updateCustomer(id, input));
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
    await deleteCustomer(id);
    return ok({ success: true });
  } catch (error) {
    return handleError(error);
  }
}
