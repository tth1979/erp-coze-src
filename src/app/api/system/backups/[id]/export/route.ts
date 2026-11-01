import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError } from '@/server/http';
import { exportBackupPayload } from '@/server/system/backups';

/** 导出备份快照 JSON（真实数据下载） */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request);
    requirePermission(auth.user, 'sys.read');
    const { id } = await ctx.params;
    const { meta, payload } = await exportBackupPayload(id);
    const body = JSON.stringify(
      {
        backup_no: meta.backup_no,
        backup_time: meta.backup_time,
        backup_type: meta.backup_type,
        scope: meta.scope,
        table_stats: meta.table_stats,
        total_rows: meta.total_rows,
        payload,
      },
      null,
      2,
    );
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${meta.backup_no}.json"`,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
