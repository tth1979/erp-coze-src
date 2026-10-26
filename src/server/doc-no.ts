/**
 * 业务单号生成：<letters>yyyymmdd-NNNN。
 * 取"当日最大序号 + 1"而非 count+1，避免删除中间单号后 count 与 max 错位导致撞号；
 * 数据库 unique 约束仍作兜底，调用方在 23505 冲突时重试。
 */
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { throwDbError } from '@/server/master-data/helpers';

export async function nextDocNo(letters: string, table: string, column: string): Promise<string> {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const prefix = `${letters}${y}${m}${d}`;
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .like(column, `${prefix}-%`)
    .order(column, { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throwDbError(error, '生成单号');
  const row = data as unknown as Record<string, unknown> | null;
  const last = row ? String(row[column] ?? '') : '';
  const match = /-(\d+)$/.exec(last);
  const seq = (match ? parseInt(match[1], 10) : 0) + 1;
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}
