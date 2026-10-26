import { NextRequest } from 'next/server';
import { requireAuth } from '@/server/auth/guard';
import { listPermissions } from '@/server/auth/permissions';
import { handleError, ok } from '@/server/http';

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireAuth(request);
    return ok({
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        status: user.status,
      },
      permissions: listPermissions(user.role),
    });
  } catch (error) {
    return handleError(error);
  }
}
