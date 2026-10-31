/**
 * 期间锁定守卫（独立模块避免循环依赖）
 * 结账后该期间凭证与新业务单据锁定，禁止再创建/过账，仅可红冲或反结账。
 */
import { ApiError } from '@/server/http';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { throwDbError } from '@/server/master-data/helpers';

export async function isPeriodLocked(period: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fin_accounting_periods').select('status, locked').eq('period', period).maybeSingle();
  if (error) throwDbError(error, '查询期间锁定状态');
  if (!data) return false;
  const s = (data as Record<string, unknown>).status;
  return s === 'closed' || s === 'annual_closed' || Boolean((data as Record<string, unknown>).locked);
}

/** 校验期间未锁定，否则 400 */
export async function assertPeriodOpen(period: string): Promise<void> {
  if (await isPeriodLocked(period)) {
    throw new ApiError(400, 'FIN.PERIOD_LOCKED', `期间 ${period} 已结账锁定，禁止新增/过账凭证；如需调整请先反结账或红字冲销`);
  }
}