/**
 * DEV 环境测试账号种子脚本（生产环境禁止执行）
 *
 * 用法：pnpm tsx scripts/seed-dev.ts
 *
 * 行为：
 * - 仅在 COZE_PROJECT_ENV === 'DEV' 时执行，否则直接退出
 * - 账号不存在时创建，密码运行时强随机生成并打印到控制台（不落任何文件）
 * - 账号已存在则跳过（不会重置密码）
 */
import crypto from 'node:crypto';
import { getSupabaseClient } from '../src/storage/database/supabase-client';
import { hashPassword } from '../src/server/auth/password';

interface SeedAccount {
  username: string;
  displayName: string;
  role: 'admin' | 'manager' | 'staff';
}

const ACCOUNTS: SeedAccount[] = [
  { username: 'ADMIN', displayName: '系统管理员', role: 'admin' },
  { username: 'dev_user@coze.dev', displayName: '开发业务员', role: 'staff' },
];

async function main(): Promise<void> {
  if (process.env.COZE_PROJECT_ENV !== 'DEV') {
    console.error('[seed] 仅允许在 DEV 环境执行（COZE_PROJECT_ENV !== DEV），已退出');
    process.exit(1);
  }

  const supabase = getSupabaseClient();

  for (const account of ACCOUNTS) {
    const { data: existing, error: queryError } = await supabase
      .from('sys_user_credentials')
      .select('id')
      .eq('type', 'password')
      .eq('identifier', account.username)
      .maybeSingle();
    if (queryError) throw new Error(`查询凭证失败: ${queryError.message}`);
    if (existing) {
      console.log(`[seed] ${account.username} 已存在，跳过`);
      continue;
    }

    const password = crypto.randomBytes(9).toString('base64url');
    const { data: user, error: userError } = await supabase
      .from('sys_users')
      .insert({ username: account.username, display_name: account.displayName, role: account.role })
      .select('id')
      .single();
    if (userError || !user) throw new Error(`创建用户失败: ${userError?.message ?? 'unknown'}`);

    const { error: credError } = await supabase.from('sys_user_credentials').insert({
      user_id: user.id as string,
      type: 'password',
      identifier: account.username,
      secret_hash: await hashPassword(password),
      verified_at: new Date().toISOString(),
    });
    if (credError) throw new Error(`写入凭证失败: ${credError.message}`);

    console.log(`[seed] 已创建 ${account.role} 账号 ${account.username} 密码: ${password}`);
  }
}

main().catch((error: unknown) => {
  console.error('[seed] 执行失败:', error);
  process.exit(1);
});
