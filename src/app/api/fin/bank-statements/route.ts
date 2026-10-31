import { NextRequest } from 'next/server';
import { z } from 'zod';
import { fail, handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { listBankStatements, createBankStatement, importBankStatements, DEFAULT_BANK_ACCOUNT } from '@/server/finance/bank';
import { parseListQuery } from '@/server/master-data/helpers';

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.read');
    const params = req.nextUrl.searchParams;
    const query = parseListQuery(params);
    const result = await listBankStatements(query, {
      account: params.get('account') || undefined,
      matched: params.get('matched') || undefined,
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
    const body = await req.json();
    // 支持单条或批量导入
    if (body && Array.isArray(body.rows)) {
      const result = await importBankStatements(body.rows, user);
      return ok(result, 201);
    }
    const result = await createBankStatement({ bank_account: DEFAULT_BANK_ACCOUNT, ...body }, user);
    return ok(result, 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('FIN.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
