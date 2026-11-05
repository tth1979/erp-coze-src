import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError } from '@/server/http';
import { listQuotes } from '@/server/sales/quotes';

/** 报价单导出（CSV，同列表筛选口径） */
export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    requirePermission(user, 'so.read');
    const sp = request.nextUrl.searchParams;
    const result = await listQuotes({
      page: 1,
      pageSize: 100,
      keyword: (sp.get('keyword') ?? '').trim(),
      status: sp.get('status') ?? undefined,
      customer_id: sp.get('customer_id') ?? undefined,
      date_from: sp.get('date_from') ?? undefined,
      date_to: sp.get('date_to') ?? undefined,
    });
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      'quote_no,customer_name,quote_date,valid_until,status,total_amount,item_count,salesman,converted_order_no,created_at',
      ...result.items.map((r) =>
        [
          r.quote_no,
          r.customer_name,
          r.quote_date,
          r.valid_until,
          r.status,
          r.total_amount,
          r.item_count,
          r.salesman,
          r.converted_order_no,
          r.created_at,
        ]
          .map(esc)
          .join(','),
      ),
    ];
    return new NextResponse(`﻿${lines.join('\n')}`, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="quotes.csv"',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
