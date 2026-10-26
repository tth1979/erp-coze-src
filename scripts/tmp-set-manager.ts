import { hashPassword } from '../src/server/auth/password';
import { getSupabaseClient } from '../src/storage/database/supabase-client';

async function main() {
  const username = 'dev_manager@coze.dev';
  const supabase = getSupabaseClient();
  const { data: existing, error: qErr } = await supabase
    .from('sys_users')
    .select('id')
    .eq('username', username)
    .maybeSingle();
  console.log('query:', existing, qErr?.message);

  let userId = existing?.id as string | undefined;
  if (!userId) {
    userId = crypto.randomUUID();
    const { error } = await supabase.from('sys_users').insert({
      id: userId,
      username,
      display_name: '冒烟主管',
      role: 'manager',
      status: 'active',
    });
    console.log('insert user err:', error?.message, error?.details, error?.hint);
    if (error) process.exit(1);
  }
  console.log('userId:', userId);
}
main().catch((err) => { console.error(err); process.exit(1); });
