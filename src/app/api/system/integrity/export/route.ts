import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError } from '@/server/http';
import { listIntegrityChecks } from '@/server/system/integrity';

/** 断言结果导出（CSV，供归档/外部分析） */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    requirePermission(auth.user, 'sys.read');
    const sp = request.nextUrl.searchParams;
    const result = await listIntegrityChecks({
      page: 1,
      pageSize: 100,
      keyword: (sp.get('keyword') ?? '').trim(),
      result: sp.get('result') ?? undefined,
      check_key: sp.get('check_key') ?? undefined,
      check_group: sp.get('check_group') ?? undefined,
    });
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      'run_id,check_group,check_key,check_name,result,severity,failure_type,created_at',
      ...result.items.map((r) =>
        [r.run_id, r.check_group, r.check_key, r.check_name, r.result, r.severity, r.failure_type, r.created_at]
          .map(esc)
          .join(','),
      ),
    ];
    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="integrity-checks.csv"',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
