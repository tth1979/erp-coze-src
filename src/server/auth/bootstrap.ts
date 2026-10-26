import { getSupabaseClient } from '@/storage/database/supabase-client';
import { hashPassword } from '@/server/auth/password';

const BOOTSTRAP_USER = (process.env.ERP_BOOTSTRAP_USER ?? 'admin123').toLowerCase();
const BOOTSTRAP_PASSWORD = process.env.ERP_BOOTSTRAP_PASSWORD ?? 'admin123';

let attempted = false;

/**
 * 幂等自举：确保初始管理员的 password 凭证存在。
 *
 * 背景：开发库（develop）与生产库（product）相互独立。种子脚本只写入开发库，
 * 生产部署首启时若没有任何可登录账号，会导致"任何密码都登录失败"。
 * 该自举在登录接口入口处执行一次：仅当目标凭证不存在时创建，绝不覆盖已有口令，
 * 因此不会被重复触发或用于重置密码。
 *
 * 安全注意：默认口令为弱口令，仅供首启应急；上线前务必修改，或通过环境变量
 * ERP_BOOTSTRAP_USER / ERP_BOOTSTRAP_PASSWORD 覆盖默认值。
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  if (attempted) return;
  attempted = true;
  try {
    const supabase = getSupabaseClient();

    const { data: existing, error: queryError } = await supabase
      .from('sys_user_credentials')
      .select('id')
      .eq('type', 'password')
      .eq('identifier', BOOTSTRAP_USER)
      .maybeSingle();
    if (queryError) throw new Error(`查询凭证失败: ${queryError.message}`);
    if (existing) return; // 已存在，正常情况直接返回

    // 找一个现有的启用状态管理员，优先复用；没有则新建
    const { data: adminUser, error: userError } = await supabase
      .from('sys_users')
      .select('id, username')
      .eq('role', 'admin')
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (userError) throw new Error(`查询管理员失败: ${userError.message}`);

    let userId: string;
    if (adminUser) {
      userId = adminUser.id as string;
      // 若管理员仍是 DEV 种子账号名，改名为自举账号，避免生产环境残留测试标识
      if ((adminUser.username as string).endsWith('@coze.dev')) {
        await supabase.from('sys_users').update({ username: BOOTSTRAP_USER }).eq('id', userId);
      }
      // 清理该用户的 DEV 测试凭证，防止旧随机口令在生产环境继续可用
      await supabase
        .from('sys_user_credentials')
        .delete()
        .eq('user_id', userId)
        .eq('type', 'password')
        .like('identifier', '%@coze.dev');
    } else {
      const { data: created, error: createError } = await supabase
        .from('sys_users')
        .insert({ username: BOOTSTRAP_USER, display_name: '系统管理员', role: 'admin', status: 'active' })
        .select('id')
        .single();
      if (createError || !created) throw new Error(`创建管理员失败: ${createError?.message ?? 'unknown'}`);
      userId = created.id as string;
    }

    const { error: credError } = await supabase.from('sys_user_credentials').insert({
      user_id: userId,
      type: 'password',
      identifier: BOOTSTRAP_USER,
      secret_hash: hashPassword(BOOTSTRAP_PASSWORD),
      verified_at: new Date().toISOString(),
    });
    if (credError) throw new Error(`创建凭证失败: ${credError.message}`);

    console.warn(`[bootstrap] 初始管理员已创建: ${BOOTSTRAP_USER}（默认弱口令，请尽快修改）`);
  } catch (error) {
    attempted = false; // 允许下次请求重试
    console.error('[bootstrap] 初始管理员自举失败:', error);
  }
}
