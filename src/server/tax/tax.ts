/**
 * 税务模块（tax_ schema 雏形）
 * - 销项/进项税额登记：随业务事件（销售出库→销项、采购入库→进项）自动落库
 * - 税额统计表：按期间(month)/税率汇总，为报税提供口径（不做完整纳税申报）
 */
import { ApiError } from "@/server/http";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { computeWorksheet } from "./tax-math";
import { prepaidTotalByPeriod } from "./prepaid";
import { socDiffSummary } from "./soc-diff";

export const TAX_OUTPUT = 'output';
export const TAX_INPUT = 'input';

export interface TaxFilingRow {
  rate: string;
  output_base: number;
  output_tax: number;
  input_base: number;
  input_tax: number;
}
export interface TaxFilingView {
  period: string;
  output_amount: number;
  output_base: number;
  output_tax: number;
  input_amount: number;
  input_base: number;
  input_tax: number;
  /** 可抵扣进项税（雏形：默认全部进项可抵扣） */
  deductible_input: number;
  /** 应纳增值税 = 销项 − 可抵扣进项（≥0） */
  vat_payable: number;
  /** 留抵税额 = 可抵扣进项 − 销项（≥0） */
  carried_forward: number;
  /** 异地预缴税额合计（抵减应纳税额） */
  prepaid_total: number;
  /** 应补(退)税额 = 应纳 − 预缴（>0 应补，<0 应退） */
  net_payable: number;
  /** 应退税额 = max(预缴 − 应纳, 0) */
  refundable: number;
  /** 税会差异提示（时间性/永久性） */
  soc_diff: {
    temporary_count: number;
    temporary_amount: number;
    permanent_count: number;
    permanent_amount: number;
  };
  rows: TaxFilingRow[];
}

const num = (v: unknown): number => Number(v ?? 0);

/** 增值税纳税申报主表数据来源（雏形）：按期间汇总销项/进项税并计算应纳与留抵 */
export async function getTaxFiling(period: string): Promise<TaxFilingView> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('tax_entries')
    .select('*')
    .eq('period', period);
  if (error) throw new ApiError(500, 'DB', error.message);

  const rows = new Map<string, TaxFilingRow>();
  let output_amount = 0;
  let output_base = 0;
  let output_tax = 0;
  let input_amount = 0;
  let input_base = 0;
  let input_tax = 0;

  for (const r of data ?? []) {
    const t = r as Record<string, unknown>;
    const isOut = t.tax_type === TAX_OUTPUT;
    const amount = num(t.amount);
    const base = num(t.base_amount);
    const tax = num(t.tax_amount);
    if (isOut) {
      output_amount += amount;
      output_base += base;
      output_tax += tax;
    } else {
      input_amount += amount;
      input_base += base;
      input_tax += tax;
    }
    const rate = String(t.tax_rate ?? 13);
    let row = rows.get(rate);
    if (!row) {
      row = { rate, output_base: 0, output_tax: 0, input_base: 0, input_tax: 0 };
      rows.set(rate, row);
    }
    if (isOut) {
      row.output_base += base;
      row.output_tax += tax;
    } else {
      row.input_base += base;
      row.input_tax += tax;
    }
  }

  const deductible = round2(input_tax);
  const diff = round2(output_tax - deductible);
  const [prepaid, socDiff] = await Promise.all([prepaidTotalByPeriod(period), socDiffSummary(period)]);
  const ws = computeWorksheet({ output_tax, deductible_input: deductible, prepaid_total: prepaid });
  return {
    period,
    output_amount: round2(output_amount),
    output_base: round2(output_base),
    output_tax: round2(output_tax),
    input_amount: round2(input_amount),
    input_base: round2(input_base),
    input_tax: round2(input_tax),
    deductible_input: deductible,
    vat_payable: Math.max(diff, 0),
    carried_forward: Math.max(-diff, 0),
    prepaid_total: ws.prepaid_total,
    net_payable: ws.net_payable,
    refundable: ws.refundable,
    soc_diff: socDiff,
    rows: [...rows.values()],
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

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