import { NextRequest } from 'next/server';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';
import { clientIp, writeAuditLog } from '@/server/system/audit';
import { postVoucher } from '@/server/ledger/ledger';

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'fin.write');
    const { id } = await ctx.params;
    const result = await postVoucher(id, { id: user.id });
    // 审计：凭证过账
    await writeAuditLog({
      userId: user.id,
      username: user.username,
      action: 'voucher.post',
      resource: 'fin_voucher',
      resourceId: id,
      ip: clientIp(req),
    });
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}