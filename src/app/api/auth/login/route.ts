import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { SysUser } from '@/storage/database/shared/schema';
import { issueSession, SESSION_COOKIE } from '@/server/auth/session';
import { verifyPassword } from '@/server/auth/password';
import { listPermissions } from '@/server/auth/permissions';
import { fail, handleError, ok } from '@/server/http';

const loginSchema = z.object({
  type: z.literal('password'),
  payload: z.object({
    username: z.string().trim().min(1, '用户名不能为空'),
    password: z.string().min(1, '密码不能为空'),
  }),
});

function toPublicUser(user: SysUser) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    status: user.status,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = loginSchema.parse(await request.json());
    const { username, password } = body.payload;

    // 门控铁律：非 DEV 环境拒绝测试账号登录
    if (process.env.COZE_PROJECT_ENV !== 'DEV' && username.endsWith('@coze.dev')) {
      console.error(`[security] 非 DEV 环境检测到测试账号登录尝试: ${username}`);
      return fail('AUTH.INVALID_CREDENTIALS', '用户名或密码错误', 401);
    }

    const client = getSupabaseClient();
    const { data: credential, error: credError } = await client
      .from('sys_user_credentials')
      .select('*')
      .eq('type', 'password')
      .eq('identifier', username)
      .maybeSingle();
    if (credError) throw new Error(`查询凭证失败: ${credError.message}`);
    if (!credential || !verifyPassword(password, credential.secret_hash)) {
      return fail('AUTH.INVALID_CREDENTIALS', '用户名或密码错误', 401);
    }

    const { data: user, error: userError } = await client
      .from('sys_users')
      .select('*')
      .eq('id', credential.user_id)
      .maybeSingle();
    if (userError) throw new Error(`查询用户失败: ${userError.message}`);
    if (!user || user.status !== 'active') {
      return fail('AUTH.USER_DISABLED', '账号不存在或已被禁用', 401);
    }

    const { token, expiresAt } = await issueSession(user.id, {
      userAgent: request.headers.get('user-agent') ?? undefined,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
    });

    const response = ok({
      user: toPublicUser(user as SysUser),
      permissions: listPermissions(user.role),
    });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
      secure: request.url.startsWith('https'),
    });
    return response;
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail('AUTH.BAD_REQUEST', error.issues[0]?.message ?? '请求参数错误', 400);
    }
    return handleError(error);
  }
}
