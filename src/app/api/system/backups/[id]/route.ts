import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { ok, handleError } from '@/server/http';
import { RESTORE_GUIDE, getBackup } from '@/server/system/backups';

/** 备份详情（含 table_stats 校验和 + 恢复指引） */
export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request);
    requirePermission(auth.user, 'sys.read');
    const { id } = await ctx.params;
    const view = await getBackup(id);
    return ok({ ...view, restore_guide: RESTORE_GUIDE });
  } catch (error) {
    return handleError(error);
  }
}
