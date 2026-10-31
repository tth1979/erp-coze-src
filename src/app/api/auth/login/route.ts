import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { SysUser } from '@/storage/database/shared/schema';
import { issueSession, SESSION_COOKIE } from '@/server/auth/session';
import { verifyPassword } from '@/server/auth/password';
import { ensureBootstrapAdmin } from '@/server/auth/bootstrap';
import { listPermissions } from '@/server/auth/permissions';
import { clientIp, writeAuditLog } from '@/server/system/audit';
import { fail, handleError, ok } from '@/server/http';

const isDev = process.env.COZE_PROJECT_ENV === 'DEV';

/**
 * 归一化凭证输入：全角字符（U+FF01-U+FF5E）转半角、去除零宽字符（U+200B-U+200D / U+FEFF）、去首尾空白。
 * 防止中文输入法全角状态、聊天窗口复制粘贴夹带不可见字符导致"看着正确却登录失败"。
 */
function normalizeCredentialInput(value: string): string {
  return value
    .replace(/[​-‍﻿]/g, '')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .trim();
}

const loginSchema = z.object({
  type: z.literal('password'),
  payload: z.object({
    username: z.string().transform(normalizeCredentialInput).pipe(z.string().min(1, '用户名不能为空')),
    password: z.string().transform(normalizeCredentialInput).pipe(z.string().min(1, '密码不能为空')),
  }),
});

/** DEV 环境在错误信息中附带服务端实际收到的输入特征，便于定位"输入与预期不一致"类问题 */
function devDebug(username: string, password: string, credentialFound: boolean): string {
  if (!isDev) return '';
  return `（DEV 调试：服务端收到用户名「${username}」${[...username].length} 字符，密码 ${[...password].length} 字符，凭证${credentialFound ? '存在但密码不匹配' : '不存在'}）`;
}

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

    // 幂等自举：生产库首启时确保初始管理员存在（仅创建一次，不覆盖已有口令）
    await ensureBootstrapAdmin();

    // 门控铁律：非 DEV 环境拒绝测试账号登录
    if (!isDev && username.endsWith('@coze.dev')) {
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
    if (!credential) {
      return fail('AUTH.INVALID_CREDENTIALS', `用户名或密码错误${devDebug(username, password, false)}`, 401);
    }
    if (!verifyPassword(password, credential.secret_hash)) {
      return fail('AUTH.INVALID_CREDENTIALS', `用户名或密码错误${devDebug(username, password, true)}`, 401);
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

    // 审计：登录成功
    await writeAuditLog({
      userId: user.id,
      username: user.username,
      action: 'auth.login',
      resource: 'auth',
      resourceId: user.id,
      ip: clientIp(request),
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
