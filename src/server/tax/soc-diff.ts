/**
 * 税会差异（tax_soc_diff）
 * - 时间性差异：日常计提，逐期转回（日常提示）
 * - 永久性差异：留待汇算清缴处理
 * - 差异额 = 税法金额 − 会计金额（服务端计算，不写死）
 */
import { ApiError } from '@/server/http';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { emptyToNull, escapeOrKeyword, throwDbError } from '@/server/master-data/helpers';
import { round2, socDiffAmount } from './tax-math';

const TABLE = 'tax_soc_diff';

export const DIFF_TYPES = ['temporary', 'permanent'] as const;

export interface SocDiffRow {
  id: string;
  period: string;
  diff_type: string;
  item: string;
  description: string | null;
  tax_base: number;
  accounting_base: number;
  diff_amount: number;
  status: string;
  remark: string | null;
  created_at: string;
}

const num = (v: unknown): number => Math.round(Number(v ?? 0) * 100) / 100;

function mapRow(r: Record<string, unknown>): SocDiffRow {
  return {
    id: String(r.id),
    period: String(r.period),
    diff_type: String(r.diff_type ?? 'temporary'),
    item: String(r.item),
    description: (r.description as string | null) ?? null,
    tax_base: num(r.tax_base),
    accounting_base: num(r.accounting_base),
    diff_amount: num(r.diff_amount),
    status: String(r.status ?? 'open'),
    remark: (r.remark as string | null) ?? null,
    created_at: String(r.created_at),
  };
}

export interface SocDiffListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  period?: string;
  diff_type?: string;
}

export async function listSocDiff(query: SocDiffListQuery): Promise<{
  items: SocDiffRow[];
  total: number;
  page: number;
  page_size: number;
}> {
  const supabase = getSupabaseClient();
  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize = Math.min(query.pageSize && query.pageSize > 0 ? query.pageSize : 20, 100);
  let q = supabase.from(TABLE).select('*', { count: 'exact' });
  if (query.period) q = q.eq('period', query.period);
  if (query.diff_type) q = q.eq('diff_type', query.diff_type);
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    q = q.or(`item.ilike.%${kw}%,description.ilike.%${kw}%`);
  }
  const { data, error, count } = await q
    .order('period', { ascending: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(500, 'DB', error.message);
  return {
    items: (data ?? []).map((r) => mapRow(r as Record<string, unknown>)),
    total: count ?? (data ?? []).length,
    page,
    page_size: pageSize,
  };
}

export interface SocDiffInput {
  period: string;
  diff_type: string;
  item: string;
  description?: string | null;
  tax_base: number;
  accounting_base: number;
  remark?: string | null;
}

export async function createSocDiff(input: SocDiffInput, operatorId: string): Promise<SocDiffRow> {
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new ApiError(400, 'TAX.BAD_PERIOD', '期间格式应为 YYYY-MM');
  if (!DIFF_TYPES.includes(input.diff_type as (typeof DIFF_TYPES)[number])) {
    throw new ApiError(400, 'TAX.BAD_DIFF_TYPE', '差异类型须为 temporary 或 permanent');
  }
  if (!input.item?.trim()) throw new ApiError(400, 'TAX.NO_ITEM', '差异项目不能为空');
  const diff = socDiffAmount({ tax_base: Number(input.tax_base ?? 0), accounting_base: Number(input.accounting_base ?? 0) });
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      period: input.period,
      diff_type: input.diff_type,
      item: input.item.trim(),
      description: emptyToNull(input.description),
      tax_base: String(round2(Number(input.tax_base ?? 0)).toFixed(2)),
      accounting_base: String(round2(Number(input.accounting_base ?? 0)).toFixed(2)),
      diff_amount: String(diff.toFixed(2)),
      status: 'open',
      remark: emptyToNull(input.remark),
      created_by: operatorId,
    })
    .select('*')
    .single();
  if (error) throw new ApiError(500, 'DB', error.message);
  return mapRow(data as Record<string, unknown>);
}

export async function deleteSocDiff(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throwDbError(error, '删除');
}

/** 期间税会差异统计：时间性/永久性 各自笔数与差异额合计 */
export async function socDiffSummary(period: string): Promise<{
  temporary_count: number;
  temporary_amount: number;
  permanent_count: number;
  permanent_amount: number;
}> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(TABLE).select('diff_type,diff_amount').eq('period', period);
  if (error) throw new ApiError(500, 'DB', error.message);
  let temporary_count = 0;
  let temporary_amount = 0;
  let permanent_count = 0;
  let permanent_amount = 0;
  for (const r of data ?? []) {
    const t = r as Record<string, unknown>;
    const amt = Number(t.diff_amount ?? 0);
    if (t.diff_type === 'permanent') {
      permanent_count += 1;
      permanent_amount += amt;
    } else {
      temporary_count += 1;
      temporary_amount += amt;
    }
  }
  return {
    temporary_count,
    temporary_amount: round2(temporary_amount),
    permanent_count,
    permanent_amount: round2(permanent_amount),
  };
}
