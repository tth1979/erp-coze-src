import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { fail, handleError, ok } from '@/server/http';
import { parseListQuery } from '@/server/master-data/helpers';
import { createCustomer, listCustomers } from '@/server/master-data/customers';

const createSchema = z.object({
  code: z.string().trim().min(1, '客户编码不能为空').max(32),
  name: z.string().trim().min(1, '客户名称不能为空').max(128),
  contact: z.string().trim().max(64).nullish(),
  phone: z.string().trim().max(32).nullish(),
  email: z.string().trim().email('邮箱格式不正确').max(128).nullish().or(z.literal('')),
  address: z.string().trim().max(256).nullish(),
  level: z.enum(['normal', 'vip', 'strategic']).optional(),
  tax_no: z.string().trim().max(64).nullish(),
  status: z.enum(['active', 'disabled']).optional(),
  remark: z.string().max(2000).nullish(),
});

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.read');
    const result = await listCustomers(parseListQuery(request.nextUrl.searchParams));
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'md.write');
    const input = createSchema.parse(await request.json());
    const created = await createCustomer(input);
    return ok(created, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('MD.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
