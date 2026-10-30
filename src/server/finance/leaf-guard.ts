/**
 * 记账科目末级守卫（fin_subjects）：保证凭证分录只挂末级且启用的科目。
 * 独立成模块，避免 ledger ↔ subjects 的循环依赖。
 */
import { ApiError } from '@/server/http';
import { throwDbError } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';

/** 校验编码均存在、启用且为末级科目；否则抛 4xx */
export async function ensureLeafCodes(codes: string[]): Promise<void> {
  if (!codes.length) return;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fin_subjects').select('subject_code, is_leaf, status').in('subject_code', codes);
  if (error) throwDbError(error, '校验科目末级');
  const found = new Map((data ?? []).map((r) => [r.subject_code, r as Record<string, unknown>]));
  for (const code of codes) {
    const row = found.get(code);
    if (!row) throw new ApiError(400, 'FIN.SUBJECT_MISSING', `记账科目 ${code} 不存在，请先在科目字典维护`);
    if (row.status === 'disabled') throw new ApiError(400, 'FIN.SUBJECT_DISABLED', `记账科目 ${code} 已停用`);
    if (!row.is_leaf) throw new ApiError(400, 'FIN.SUBJECT_NOT_LEAF', `记账科目 ${code} 非末级科目，不可直接用于凭证分录`);
  }
}