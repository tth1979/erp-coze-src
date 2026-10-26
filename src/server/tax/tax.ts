/**
 * 税务模块（tax_ schema 雏形）
 * - 销项/进项税额登记：随业务事件（销售出库→销项、采购入库→进项）自动落库
 * - 税额统计表：按期间(month)/税率汇总，为报税提供口径（不做完整纳税申报）
 */
import { ApiError } from "@/server/http";
import { getSupabaseClient } from "@/storage/database/supabase-client";

export const TAX_OUTPUT = 'output';
export const TAX_INPUT = 'input';

export interface TaxEntryInput {
  tax_type: string;
  period: string;
  tax_rate: number;
  amount: number;
  base_amount: number;
  tax_amount: number;
  doc_no?: string;
  ref_type?: string;
  ref_id?: string;
  operatorId: string;
}

/** 幂等写入一条税额登记（ref_type+ref_id+tax_type 唯一，防重复生成） */
export async function registerTaxEntry(input: TaxEntryInput): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('tax_entries').upsert(
    {
      tax_type: input.tax_type,
      period: input.period,
      tax_rate: String(input.tax_rate),
      amount: String(input.amount.toFixed(2)),
      base_amount: String(input.base_amount.toFixed(2)),
      tax_amount: String(input.tax_amount.toFixed(2)),
      doc_no: input.doc_no ?? null,
      ref_type: input.ref_type ?? null,
      ref_id: input.ref_id ?? null,
      source: 'auto',
      status: 'active',
      created_by: input.operatorId,
    },
    { onConflict: 'ref_type,ref_id,tax_type', ignoreDuplicates: false },
  );
  if (error) {
    // 唯一约束命中 → 幂等，忽略
    if (error.message && /tax_entries_ref_uniq|tax_entries_ref/.test(error.message)) return;
    throw new ApiError(500, 'DB', error.message);
  }
}

export interface TaxRow {
  id: string;
  tax_type: string;
  period: string;
  tax_rate: string;
  amount: string;
  base_amount: string;
  tax_amount: string;
  doc_no: string | null;
  ref_type: string | null;
  ref_id: string | null;
  created_at: string;
}

export interface TaxSummaryRow {
  period: string;
  tax_rate: string;
  output_amount: number;
  output_base: number;
  output_tax: number;
  input_amount: number;
  input_base: number;
  input_tax: number;
}

export interface TaxListQuery {
  page?: number;
  page_size?: number;
  tax_type?: string;
  period?: string;
  keyword?: string;
}

/** 税额登记列表（分页，可按类型/期间过滤） */
export async function listTaxEntries(query: TaxListQuery = {}): Promise<{
  items: TaxRow[];
  total: number;
  page: number;
  page_size: number;
}> {
  const supabase = getSupabaseClient();
  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize = Math.min(query.page_size && query.page_size > 0 ? query.page_size : 20, 100);
  let q = supabase.from('tax_entries').select('*', { count: 'exact' });
  if (query.tax_type) q = q.eq('tax_type', query.tax_type);
  if (query.period) q = q.eq('period', query.period);
  if (query.keyword) q = q.or(`doc_no.ilike.%${query.keyword}%`);
  const { data, error, count } = await q
    .order('period', { ascending: false })
    .order('created_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(500, 'DB', error.message);
  return {
    items: (data ?? []) as unknown as TaxRow[],
    total: count ?? (data ?? []).length,
    page,
    page_size: pageSize,
  };
}

/** 期间×税率汇总（内存聚合，SDK-only，不建视图） */
export async function listTaxSummary(): Promise<TaxSummaryRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('tax_entries').select('*').order('period', { ascending: false });
  if (error) throw new ApiError(500, 'DB', error.message);
  const map = new Map<string, TaxSummaryRow>();
  for (const r of data ?? []) {
    const t = r as Record<string, unknown>;
    const key = `${t.period}|${t.tax_rate}`;
    let row = map.get(key);
    if (!row) {
      row = { period: t.period as string, tax_rate: String(t.tax_rate), output_amount: 0, output_base: 0, output_tax: 0, input_amount: 0, input_base: 0, input_tax: 0 };
      map.set(key, row);
    }
    const isOut = t.tax_type === TAX_OUTPUT;
    const num = (v: unknown) => Number(v ?? 0);
    if (isOut) {
      row.output_amount += num(t.amount);
      row.output_base += num(t.base_amount);
      row.output_tax += num(t.tax_amount);
    } else {
      row.input_amount += num(t.amount);
      row.input_base += num(t.base_amount);
      row.input_tax += num(t.tax_amount);
    }
  }
  return [...map.values()];
}