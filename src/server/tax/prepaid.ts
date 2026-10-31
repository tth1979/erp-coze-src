/**
 * 异地预缴（tax_prepaid）
 * - 工程项目地预缴增值税登记
 * - 期间预缴合计供申报底稿抵减应纳税额
 */
import { ApiError } from '@/server/http';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { emptyToNull, escapeOrKeyword, throwDbError } from '@/server/master-data/helpers';
import { round2 } from './tax-math';

const TABLE = 'tax_prepaid';

export interface PrepaidRow {
  id: string;
  period: string;
  project: string;
  region: string | null;
  prepaid_amount: number;
  based_tax: number;
  prepaid_date: string;
  related: string | null;
  status: string;
  remark: string | null;
  created_at: string;
}

const num = (v: unknown): number => Math.round(Number(v ?? 0) * 100) / 100;

function mapRow(r: Record<string, unknown>): PrepaidRow {
  return {
    id: String(r.id),
    period: String(r.period),
    project: String(r.project),
    region: (r.region as string | null) ?? null,
    prepaid_amount: num(r.prepaid_amount),
    based_tax: num(r.based_tax),
    prepaid_date: String(r.prepaid_date),
    related: (r.related as string | null) ?? null,
    status: String(r.status ?? 'active'),
    remark: (r.remark as string | null) ?? null,
    created_at: String(r.created_at),
  };
}

export interface PrepaidListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  period?: string;
  status?: string;
}

export async function listPrepaid(query: PrepaidListQuery): Promise<{
  items: PrepaidRow[];
  total: number;
  page: number;
  page_size: number;
}> {
  const supabase = getSupabaseClient();
  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize = Math.min(query.pageSize && query.pageSize > 0 ? query.pageSize : 20, 100);
  let q = supabase.from(TABLE).select('*', { count: 'exact' });
  if (query.period) q = q.eq('period', query.period);
  if (query.status) q = q.eq('status', query.status);
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    q = q.or(`project.ilike.%${kw}%,region.ilike.%${kw}%,related.ilike.%${kw}%`);
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

export interface PrepaidInput {
  period: string;
  project: string;
  region?: string | null;
  prepaid_amount: number;
  based_tax?: number;
  prepaid_date: string;
  related?: string | null;
  remark?: string | null;
}

export async function createPrepaid(input: PrepaidInput, operatorId: string): Promise<PrepaidRow> {
  if (!/^\d{4}-\d{2}$/.test(input.period)) throw new ApiError(400, 'TAX.BAD_PERIOD', '期间格式应为 YYYY-MM');
  if (!input.project?.trim()) throw new ApiError(400, 'TAX.NO_PROJECT', '工程项目不能为空');
  if (Number(input.prepaid_amount) < 0) throw new ApiError(400, 'TAX.BAD_AMOUNT', '预缴税额不能为负');
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      period: input.period,
      project: input.project.trim(),
      region: emptyToNull(input.region),
      prepaid_amount: String(round2(Number(input.prepaid_amount)).toFixed(2)),
      based_tax: String(round2(Number(input.based_tax ?? 0)).toFixed(2)),
      prepaid_date: input.prepaid_date,
      related: emptyToNull(input.related),
      status: 'active',
      remark: emptyToNull(input.remark),
      created_by: operatorId,
    })
    .select('*')
    .single();
  if (error) throw new ApiError(500, 'DB', error.message);
  return mapRow(data as Record<string, unknown>);
}

export async function deletePrepaid(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throwDbError(error, '删除');
}

/** 期间预缴税额合计（仅 active） */
export async function prepaidTotalByPeriod(period: string): Promise<number> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select('prepaid_amount,status')
    .eq('period', period)
    .eq('status', 'active');
  if (error) throw new ApiError(500, 'DB', error.message);
  let total = 0;
  for (const r of data ?? []) total += Number((r as Record<string, unknown>).prepaid_amount ?? 0);
  return round2(total);
}
