import { NextRequest } from 'next/server';
import { effectivePermissionsOf, requireAuth } from '@/server/auth/guard';
import { handleError, ok } from '@/server/http';

export async function GET(request: NextRequest) {
  try {
    const { user, dataScope } = await requireAuth(request);
    return ok({
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        status: user.status,
        dept: (user as unknown as Record<string, unknown>).dept ?? null,
      },
      permissions: effectivePermissionsOf(user),
      data_scope: dataScope,
      custom_role_ids: user.customRoleIds ?? [],
    });
  } catch (error) {
    return handleError(error);
  }
}
