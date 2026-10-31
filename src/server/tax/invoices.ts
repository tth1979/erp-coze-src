/**
 * 发票台账（tax_invoices）
 * - 进项/销项发票登记、勾选认证、申报标记、作废
 * - 发票号同方向唯一（409），价税合计由明细计算
 */
import { ApiError } from '@/server/http';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { emptyToNull, escapeOrKeyword, throwDbError } from '@/server/master-data/helpers';
import { invoiceTotal, round2 } from './tax-math';

const TABLE = 'tax_invoices';

export const INVOICE_DIRECTIONS = ['input', 'output'] as const;
export const INVOICE_STATUSES = ['pending', 'checked', 'filed', 'void'] as const;

export interface InvoiceRow {
  id: string;
  invoice_no: string;
  invoice_code: string | null;
  invoice_type: string;
  direction: string;
  invoice_date: string;
  period: string;
  amount_ex_tax: number;
  tax_amount: number;
  amount_total: number;
  rate: number;
  related_bill: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  customer_id: string | null;
  customer_name: string | null;
  status: string;
  remark: string | null;
  created_at: string;
}

const num = (v: unknown): number => Math.round(Number(v ?? 0) * 100) / 100;

function mapRow(r: Record<string, unknown>): InvoiceRow {
  return {
    id: String(r.id),
    invoice_no: String(r.invoice_no),
    invoice_code: (r.invoice_code as string | null) ?? null,
    invoice_type: String(r.invoice_type ?? 'special'),
    direction: String(r.direction),
    invoice_date: String(r.invoice_date),
    period: String(r.period),
    amount_ex_tax: num(r.amount_ex_tax),
    tax_amount: num(r.tax_amount),
    amount_total: num(r.amount_total),
    rate: num(r.rate),
    related_bill: (r.related_bill as string | null) ?? null,
    supplier_id: (r.supplier_id as string | null) ?? null,
    supplier_name: (r.supplier_name as string | null) ?? null,
    customer_id: (r.customer_id as string | null) ?? null,
    customer_name: (r.customer_name as string | null) ?? null,
    status: String(r.status ?? 'pending'),
    remark: (r.remark as string | null) ?? null,
    created_at: String(r.created_at),
  };
}

export interface InvoiceListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  invoice_type?: string;
  direction?: string;
  status?: string;
  period?: string;
}

export async function listInvoices(query: InvoiceListQuery): Promise<{
  items: InvoiceRow[];
  total: number;
  page: number;
  page_size: number;
}> {
  const supabase = getSupabaseClient();
  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize = Math.min(query.pageSize && query.pageSize > 0 ? query.pageSize : 20, 100);
  let q = supabase.from(TABLE).select('*', { count: 'exact' });
  if (query.invoice_type) q = q.eq('invoice_type', query.invoice_type);
  if (query.direction) q = q.eq('direction', query.direction);
  if (query.status) q = q.eq('status', query.status);
  if (query.period) q = q.eq('period', query.period);
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    q = q.or(`invoice_no.ilike.%${kw}%,related_bill.ilike.%${kw}%,supplier_name.ilike.%${kw}%,customer_name.ilike.%${kw}%`);
  }
  const { data, error, count } = await q
    .order('invoice_date', { ascending: false })
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

export async function getInvoice(id: string): Promise<InvoiceRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError(500, 'DB', error.message);
  if (!data) throw new ApiError(404, 'TAX.INVOICE_NOT_FOUND', '发票不存在');
  return mapRow(data as Record<string, unknown>);
}

export interface InvoiceInput {
  invoice_no: string;
  invoice_code?: string | null;
  invoice_type?: string;
  direction: string;
  invoice_date: string;
  period?: string;
  amount_ex_tax: number;
  tax_amount: number;
  amount_total?: number;
  rate: number;
  related_bill?: string | null;
  supplier_id?: string | null;
  supplier_name?: string | null;
  customer_id?: string | null;
  customer_name?: string | null;
  status?: string;
  remark?: string | null;
}

function normalizePeriod(date: string, period?: string): string {
  if (period && /^\d{4}-\d{2}$/.test(period)) return period;
  return String(date).slice(0, 7);
}

async function assertUnique(invoice_no: string, direction: string, excludeId?: string): Promise<void> {
  const supabase = getSupabaseClient();
  let q = supabase.from(TABLE).select('id').eq('invoice_no', invoice_no).eq('direction', direction);
  if (excludeId) q = q.neq('id', excludeId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new ApiError(500, 'DB', error.message);
  if (data) throw new ApiError(409, 'TAX.INVOICE_DUP', '同方向发票号已存在');
}

export async function createInvoice(input: InvoiceInput, operatorId: string): Promise<InvoiceRow> {
  if (!INVOICE_DIRECTIONS.includes(input.direction as (typeof INVOICE_DIRECTIONS)[number])) {
    throw new ApiError(400, 'TAX.BAD_DIRECTION', '发票方向须为 input 或 output');
  }
  const invoiceNo = input.invoice_no.trim();
  if (!invoiceNo) throw new ApiError(400, 'TAX.NO_INVOICE_NO', '发票号不能为空');
  if (Number(input.amount_ex_tax) < 0 || Number(input.tax_amount) < 0) {
    throw new ApiError(400, 'TAX.BAD_AMOUNT', '金额不能为负');
  }
  await assertUnique(invoiceNo, input.direction);

  const total = invoiceTotal({ amount_ex_tax: Number(input.amount_ex_tax), tax_amount: Number(input.tax_amount) });
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      invoice_no: invoiceNo,
      invoice_code: emptyToNull(input.invoice_code),
      invoice_type: input.invoice_type || 'special',
      direction: input.direction,
      invoice_date: input.invoice_date,
      period: normalizePeriod(input.invoice_date, input.period),
      amount_ex_tax: String(round2(Number(input.amount_ex_tax)).toFixed(2)),
      tax_amount: String(round2(Number(input.tax_amount)).toFixed(2)),
      amount_total: String(total.toFixed(2)),
      rate: String(round2(Number(input.rate ?? 13))),
      related_bill: emptyToNull(input.related_bill),
      supplier_id: emptyToNull(input.supplier_id),
      supplier_name: emptyToNull(input.supplier_name),
      customer_id: emptyToNull(input.customer_id),
      customer_name: emptyToNull(input.customer_name),
      status: input.status || 'pending',
      remark: emptyToNull(input.remark),
      created_by: operatorId,
    })
    .select('*')
    .single();
  if (error) {
    if (/tax_invoices_dir_uniq/.test(error.message)) throw new ApiError(409, 'TAX.INVOICE_DUP', '同方向发票号已存在');
    throw new ApiError(500, 'DB', error.message);
  }
  return mapRow(data as Record<string, unknown>);
}

export async function updateInvoice(id: string, input: Partial<InvoiceInput>): Promise<InvoiceRow> {
  const existing = await getInvoice(id);
  if (existing.status === 'filed') throw new ApiError(400, 'TAX.INVOICE_FILED', '已申报发票不可修改');
  const patch: Record<string, unknown> = {};
  if (input.invoice_code !== undefined) patch.invoice_code = emptyToNull(input.invoice_code);
  if (input.invoice_type !== undefined) patch.invoice_type = input.invoice_type;
  if (input.invoice_date !== undefined) {
    patch.invoice_date = input.invoice_date;
    patch.period = normalizePeriod(input.invoice_date, input.period);
  } else if (input.period !== undefined) {
    patch.period = input.period;
  }
  if (input.amount_ex_tax !== undefined || input.tax_amount !== undefined) {
    const excl = input.amount_ex_tax !== undefined ? Number(input.amount_ex_tax) : existing.amount_ex_tax;
    const tax = input.tax_amount !== undefined ? Number(input.tax_amount) : existing.tax_amount;
    if (excl < 0 || tax < 0) throw new ApiError(400, 'TAX.BAD_AMOUNT', '金额不能为负');
    patch.amount_ex_tax = String(round2(excl).toFixed(2));
    patch.tax_amount = String(round2(tax).toFixed(2));
    patch.amount_total = String(invoiceTotal({ amount_ex_tax: excl, tax_amount: tax }).toFixed(2));
  }
  if (input.rate !== undefined) patch.rate = String(round2(Number(input.rate)));
  if (input.related_bill !== undefined) patch.related_bill = emptyToNull(input.related_bill);
  if (input.supplier_id !== undefined) patch.supplier_id = emptyToNull(input.supplier_id);
  if (input.supplier_name !== undefined) patch.supplier_name = emptyToNull(input.supplier_name);
  if (input.customer_id !== undefined) patch.customer_id = emptyToNull(input.customer_id);
  if (input.customer_name !== undefined) patch.customer_name = emptyToNull(input.customer_name);
  if (input.remark !== undefined) patch.remark = emptyToNull(input.remark);
  if (Object.keys(patch).length === 0) return existing;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(TABLE).update(patch).eq('id', id).select('*').single();
  if (error) throw new ApiError(500, 'DB', error.message);
  return mapRow(data as Record<string, unknown>);
}

/** 勾选认证 / 标记申报 / 作废 */
export async function markInvoice(id: string, status: string): Promise<InvoiceRow> {
  if (!INVOICE_STATUSES.includes(status as (typeof INVOICE_STATUSES)[number])) {
    throw new ApiError(400, 'TAX.BAD_STATUS', '无效的发票状态');
  }
  const existing = await getInvoice(id);
  if (existing.status === 'void') throw new ApiError(400, 'TAX.INVOICE_VOID', '已作废发票不可变更');
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw new ApiError(500, 'DB', error.message);
  return mapRow(data as Record<string, unknown>);
}

export async function deleteInvoice(id: string): Promise<void> {
  const existing = await getInvoice(id);
  if (existing.status === 'filed') throw new ApiError(400, 'TAX.INVOICE_FILED', '已申报发票不可删除');
  const supabase = getSupabaseClient();
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throwDbError(error, '删除');
}

/** 期间发票汇总（供申报底稿） */
export async function invoiceSummary(period: string): Promise<{
  input_count: number;
  output_count: number;
  input_tax: number;
  output_tax: number;
  input_total: number;
  output_total: number;
}> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select('direction,tax_amount,amount_total,status')
    .eq('period', period);
  if (error) throw new ApiError(500, 'DB', error.message);
  let input_count = 0;
  let output_count = 0;
  let input_tax = 0;
  let output_tax = 0;
  let input_total = 0;
  let output_total = 0;
  for (const r of data ?? []) {
    const t = r as Record<string, unknown>;
    if (t.status === 'void') continue;
    if (t.direction === 'input') {
      input_count += 1;
      input_tax += Number(t.tax_amount ?? 0);
      input_total += Number(t.amount_total ?? 0);
    } else {
      output_count += 1;
      output_tax += Number(t.tax_amount ?? 0);
      output_total += Number(t.amount_total ?? 0);
    }
  }
  return {
    input_count,
    output_count,
    input_tax: round2(input_tax),
    output_tax: round2(output_tax),
    input_total: round2(input_total),
    output_total: round2(output_total),
  };
}
