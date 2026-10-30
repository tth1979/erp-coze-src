import { NextRequest } from 'next/server';
import { handleError, ok } from '@/server/http';
import { listSubjects, createSubject } from '@/server/finance/subjects';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import type { SubjectInput } from '@/server/finance/subjects';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    requirePermission(auth.user, 'fin.read');
    const params = req.nextUrl.searchParams;
    const result = await listSubjects({
      page: Math.max(1, Number(params.get('page')) || 1),
      pageSize: Math.min(100, Math.max(1, Number(params.get('pageSize')) || 20)),
      keyword: params.get('keyword') ?? '',
      category: params.get('category') ? Number(params.get('category')) : undefined,
      status: params.get('status') || undefined,
    });
    return ok(result);
  } catch (e) {
    return handleError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    requirePermission(auth.user, 'fin.write');
    const body = (await req.json()) as SubjectInput;
    const result = await createSubject(body);
    return ok(result, 201);
  } catch (e) {
    return handleError(e);
  }
}