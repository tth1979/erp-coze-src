import { createHash, randomBytes } from 'node:crypto';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import type { SysSession, SysUser } from '@/storage/database/shared/schema';

export const SESSION_COOKIE = 'erp_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

/** 签发会话：返回明文 token（仅写入客户端 httpOnly cookie），库中只存哈希 */
export async function issueSession(
  userId: string,
  ctx: { userAgent?: string; ip?: string },
): Promise<IssuedSession> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const client = getSupabaseClient();
  const { error } = await client.from('sys_sessions').insert({
    user_id: userId,
    token_hash: hashToken(token),
    user_agent: ctx.userAgent ?? null,
    ip: ctx.ip ?? null,
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error(`创建会话失败: ${error.message}`);
  return { token, expiresAt };
}

export interface ResolvedSession {
  user: SysUser;
  session: SysSession;
}

/** 解析会话：token → 会话 + 用户；无效/过期/吊销返回 null */
export async function resolveSession(token: string): Promise<ResolvedSession | null> {
  const client = getSupabaseClient();
  const { data: session, error } = await client
    .from('sys_sessions')
    .select('*')
    .eq('token_hash', hashToken(token))
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(`查询会话失败: ${error.message}`);
  if (!session) return null;

  const { data: user, error: userError } = await client
    .from('sys_users')
    .select('*')
    .eq('id', session.user_id)
    .maybeSingle();
  if (userError) throw new Error(`查询用户失败: ${userError.message}`);
  if (!user || user.status !== 'active') return null;

  // 滑动活跃时间（失败不阻断请求）
  await client
    .from('sys_sessions')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', session.id);

  return { user: user as SysUser, session: session as SysSession };
}

/** 吊销会话（登出） */
export async function revokeSession(token: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client
    .from('sys_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', hashToken(token))
    .is('revoked_at', null);
  if (error) throw new Error(`吊销会话失败: ${error.message}`);
}

/** 吊销用户全部会话（改密/禁用/风控触发） */
export async function revokeAllSessions(userId: string): Promise<void> {
  const client = getSupabaseClient();
  const { error } = await client
    .from('sys_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', userId)
    .is('revoked_at', null);
  if (error) throw new Error(`吊销用户会话失败: ${error.message}`);
}
