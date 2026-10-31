import { NextRequest } from 'next/server';
import { handleError, ok } from '@/server/http';
import { requireAuth, requirePermission } from '@/server/auth/guard';
import { deleteSocDiff } from '@/server/tax/soc-diff';

/** DELETE /api/tax/soc-diff/[id] */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireAuth(req);
    requirePermission(user, 'tax.write');
    const { id } = await params;
    await deleteSocDiff(id);
    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
