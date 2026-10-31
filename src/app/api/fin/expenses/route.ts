import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fail, handleError, ok } from '@/server/http';
import { dataScopeOf, requireAuth, requirePermission } from '@/server/auth/guard';
import { dataScopeUserIds } from '@/server/auth/permissions';
import { listExpenses, createExpense, type ClaimCreateInput } from '@/server/finance/expenses';
import { parseListQuery } from '@/server/master-data/helpers';

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.read');
    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params);
    // 数据级权限：dept/self 范围限定可见操作人
    const createdByIds = await dataScopeUserIds(user, dataScopeOf(user));
    const result = await listExpenses(query, {
      status: params.get('status') || undefined,
      period: params.get('period') || undefined,
      createdByIds,
    });
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.write');
    const body = (await req.json()) as ClaimCreateInput;
    const result = await createExpense(body, user);
    return ok(result, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('FIN.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
