/**
 * 费用报销（fin_expense_claims + fin_expense_claim_items）
 *
 * 状态机：draft → pending → approved → paying → paid；rejected 可编辑重提。
 * - 提交走通用审批引擎（docType='expense'，按含税金额分级）。
 * - 终审通过（approved）：生成费用确认凭证（借费用科目+可抵进项税 / 贷其他应付款-员工），幂等。
 * - 付款（pay）：登记 fin_payments（payment 方向）+ 生成付款凭证（借其他应付款 / 贷银行存款），幂等。
 * - 金额口径：明细行含税 amount，按税率价税分离 excl/tax；服务端重算，前端传值仅参考。
 */
import { z } from 'zod';
import { ApiError } from '@/server/http';
import { emptyToNull, escapeOrKeyword, parseListQuery, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { ensureLeafCodes } from '@/server/finance/leaf-guard';
import { round2 } from '@/server/ledger/balance-math';
import { nextDocNo } from '@/server/doc-no';
import {
  submitDocument,
  approveCurrentStep,
  rejectCurrentStep,
  listSteps,
  type ApprovalStepView,
} from '@/server/approval/engine';
import { onExpenseApprove, onExpensePay } from '@/server/ledger/events';
import type { SysUser } from '@/storage/database/shared/schema';

const CLAIM_TABLE = 'fin_expense_claims';
const ITEM_TABLE = 'fin_expense_claim_items';

export interface ExpenseItemView {
  id: string;
  line_no: number;
  subject_code: string;
  subject_name: string;
  summary: string | null;
  amount: number;
  tax_rate: number;
  excl_amount: number;
  tax_amount: number;
}

export interface ExpenseClaimView {
  id: string;
  claim_no: string;
  applicant: string;
  dept: string | null;
  claim_date: string;
  period: string;
  payee: string | null;
  pay_account: string | null;
  status: string;
  total_amount: number;
  excl_amount: number;
  tax_amount: number;
  approval_level: number | null;
  current_step: number;
  voucher_no: string | null;
  payment_id: string | null;
  reject_reason: string | null;
  remark: string | null;
  created_at: string;
  approved_at: string | null;
}

export interface ExpenseClaimDetail extends ExpenseClaimView {
  items: ExpenseItemView[];
  steps: ApprovalStepView[];
}

const itemSchema = z.object({
  subject_code: z.string().trim().min(1, '费用科目不能为空'),
  summary: z.string().trim().max(255).optional().nullable(),
  amount: z.number().nonnegative('金额不能为负'),
  tax_rate: z.number().min(0).max(100).optional().default(0),
});

const claimCreateSchema = z.object({
  applicant: z.string().trim().min(1, '报销人不能为空').max(64),
  dept: z.string().trim().max(64).optional().nullable(),
  claim_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '报销日期格式应为 YYYY-MM-DD'),
  payee: z.string().trim().max(64).optional().nullable(),
  pay_account: z.string().trim().max(32).optional().nullable(),
  remark: z.string().trim().max(1000).optional().nullable(),
  items: z.array(itemSchema).min(1, '至少一条费用明细'),
});

export type ClaimCreateInput = z.infer<typeof claimCreateSchema>;

function mapClaim(row: Record<string, unknown>): ExpenseClaimView {
  return {
    id: row.id as string,
    claim_no: row.claim_no as string,
    applicant: row.applicant as string,
    dept: (row.dept as string | null) ?? null,
    claim_date: String(row.claim_date ?? '').slice(0, 10),
    period: row.period as string,
    payee: (row.payee as string | null) ?? null,
    pay_account: (row.pay_account as string | null) ?? null,
    status: row.status as string,
    total_amount: Number(row.total_amount ?? 0),
    excl_amount: Number(row.excl_amount ?? 0),
    tax_amount: Number(row.tax_amount ?? 0),
    approval_level: (row.approval_level as number | null) ?? null,
    current_step: Number(row.current_step ?? 0),
    voucher_no: (row.voucher_no as string | null) ?? null,
    payment_id: (row.payment_id as string | null) ?? null,
    reject_reason: (row.reject_reason as string | null) ?? null,
    remark: (row.remark as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
    approved_at: row.approved_at ? String(row.approved_at) : null,
  };
}

function mapItem(row: Record<string, unknown>): ExpenseItemView {
  return {
    id: row.id as string,
    line_no: Number(row.line_no ?? 0),
    subject_code: row.subject_code as string,
    subject_name: row.subject_name as string,
    summary: (row.summary as string | null) ?? null,
    amount: Number(row.amount ?? 0),
    tax_rate: Number(row.tax_rate ?? 0),
    excl_amount: Number(row.excl_amount ?? 0),
    tax_amount: Number(row.tax_amount ?? 0),
  };
}

/** 计算明细价税分离：amount 含税 */
function computeItem(raw: z.infer<typeof itemSchema>): { excl: number; tax: number } {
  const rate = Number(raw.tax_rate ?? 0);
  if (rate <= 0) return { excl: round2(raw.amount), tax: 0 };
  const tax = round2((raw.amount * rate) / (100 + rate));
  const excl = round2(raw.amount - tax);
  return { excl, tax };
}

/** 载入报销单头（不存在抛 404） */
async function loadClaim(id: string): Promise<Record<string, unknown>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from(CLAIM_TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询费用报销单');
  if (!data) throw new ApiError(404, 'FIN.EXPENSE_NOT_FOUND', '费用报销单不存在');
  return data as Record<string, unknown>;
}

async function loadItems(claimId: string): Promise<ExpenseItemView[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(ITEM_TABLE)
    .select('*')
    .eq('claim_id', claimId)
    .order('line_no', { ascending: true });
  if (error) throwDbError(error, '查询费用明细');
  return (data ?? []).map((r) => mapItem(r as Record<string, unknown>));
}

/** 分页列表（status/period/keyword） */
export async function listExpenses(
  query: ListQuery,
  filter: { status?: string; period?: string; createdByIds?: string[] } = {},
): Promise<PagedResult<ExpenseClaimView>> {
  const supabase = getSupabaseClient();
  let builder = supabase
    .from(CLAIM_TABLE)
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false });
  if (filter.status) builder = builder.eq('status', filter.status);
  if (filter.period) builder = builder.eq('period', filter.period);
  // 数据级权限：限定可见操作人集合（all 范围不传此参）
  if (filter.createdByIds) {
    if (filter.createdByIds.length === 0) {
      return { items: [], total: 0, page: query.page, page_size: query.pageSize };
    }
    builder = builder.in('created_by', filter.createdByIds);
  }
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    if (kw) builder = builder.or(`claim_no.ilike.*${kw}*,applicant.ilike.*${kw}*`);
  }
  const from = (query.page - 1) * query.pageSize;
  const { data, error, count } = await builder.range(from, from + query.pageSize - 1);
  if (error) throwDbError(error, '查询费用报销单列表');
  return {
    items: (data ?? []).map((r) => mapClaim(r as Record<string, unknown>)),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

/** 详情：头 + 明细 + 审批步骤 */
export async function getExpenseDetail(id: string): Promise<ExpenseClaimDetail> {
  const row = await loadClaim(id);
  const items = await loadItems(id);
  const steps = await listSteps('expense', id);
  return { ...mapClaim(row), items, steps };
}

/** 新建报销单（草稿），服务端重算价税分离与合计 */
export async function createExpense(input: ClaimCreateInput, user: SysUser): Promise<ExpenseClaimDetail> {
  const parsed = claimCreateSchema.parse(input);
  const supabase = getSupabaseClient();
  await ensureLeafCodes(parsed.items.map((it) => it.subject_code));

  // 科目名称快照
  const codes = [...new Set(parsed.items.map((it) => it.subject_code))];
  const { data: subs, error: subErr } = await supabase
    .from('fin_subjects')
    .select('subject_code, subject_name')
    .in('subject_code', codes);
  if (subErr) throwDbError(subErr, '查询费用科目');
  const nameMap = new Map((subs ?? []).map((s) => [s.subject_code as string, s.subject_name as string]));

  let totalAmount = 0;
  let totalExcl = 0;
  let totalTax = 0;
  const computed = parsed.items.map((it, idx) => {
    const { excl, tax } = computeItem(it);
    totalAmount += it.amount;
    totalExcl += excl;
    totalTax += tax;
    return {
      line_no: idx + 1,
      subject_code: it.subject_code,
      subject_name: nameMap.get(it.subject_code) ?? it.subject_code,
      summary: emptyToNull(it.summary ?? null),
      amount: round2(it.amount),
      tax_rate: round2(it.tax_rate ?? 0),
      excl_amount: excl,
      tax_amount: tax,
    };
  });

  const claimNo = await nextDocNo('BX', CLAIM_TABLE, 'claim_no');
  const period = parsed.claim_date.slice(0, 7);
  const { data: head, error: headErr } = await supabase
    .from(CLAIM_TABLE)
    .insert({
      claim_no: claimNo,
      applicant: parsed.applicant,
      dept: emptyToNull(parsed.dept ?? null),
      claim_date: parsed.claim_date,
      period,
      payee: emptyToNull(parsed.payee ?? null) ?? parsed.applicant,
      pay_account: emptyToNull(parsed.pay_account ?? null) ?? '2241',
      status: 'draft',
      total_amount: round2(totalAmount),
      excl_amount: round2(totalExcl),
      tax_amount: round2(totalTax),
      remark: emptyToNull(parsed.remark ?? null),
      created_by: user.id,
    })
    .select('id')
    .single();
  if (headErr) throwDbError(headErr, '创建费用报销单');
  const claimId = (head as { id: string }).id;

  const { error: itemsErr } = await supabase
    .from(ITEM_TABLE)
    .insert(computed.map((c) => ({ claim_id: claimId, ...c })));
  if (itemsErr) throwDbError(itemsErr, '写入费用明细');

  return getExpenseDetail(claimId);
}

/** 更新报销单（仅 draft/rejected） */
export async function updateExpense(id: string, input: ClaimCreateInput): Promise<ExpenseClaimDetail> {
  const row = await loadClaim(id);
  if (row.status !== 'draft' && row.status !== 'rejected') {
    throw new ApiError(400, 'FIN.BAD_TRANSITION', '仅草稿或已驳回的报销单可编辑');
  }
  const parsed = claimCreateSchema.parse(input);
  const supabase = getSupabaseClient();
  await ensureLeafCodes(parsed.items.map((it) => it.subject_code));

  const codes = [...new Set(parsed.items.map((it) => it.subject_code))];
  const { data: subs, error: subErr } = await supabase
    .from('fin_subjects')
    .select('subject_code, subject_name')
    .in('subject_code', codes);
  if (subErr) throwDbError(subErr, '查询费用科目');
  const nameMap = new Map((subs ?? []).map((s) => [s.subject_code as string, s.subject_name as string]));

  let totalAmount = 0;
  let totalExcl = 0;
  let totalTax = 0;
  const computed = parsed.items.map((it, idx) => {
    const { excl, tax } = computeItem(it);
    totalAmount += it.amount;
    totalExcl += excl;
    totalTax += tax;
    return {
      claim_id: id,
      line_no: idx + 1,
      subject_code: it.subject_code,
      subject_name: nameMap.get(it.subject_code) ?? it.subject_code,
      summary: emptyToNull(it.summary ?? null),
      amount: round2(it.amount),
      tax_rate: round2(it.tax_rate ?? 0),
      excl_amount: excl,
      tax_amount: tax,
    };
  });

  const { error: headErr } = await supabase
    .from(CLAIM_TABLE)
    .update({
      applicant: parsed.applicant,
      dept: emptyToNull(parsed.dept ?? null),
      claim_date: parsed.claim_date,
      period: parsed.claim_date.slice(0, 7),
      payee: emptyToNull(parsed.payee ?? null) ?? parsed.applicant,
      pay_account: emptyToNull(parsed.pay_account ?? null) ?? '2241',
      total_amount: round2(totalAmount),
      excl_amount: round2(totalExcl),
      tax_amount: round2(totalTax),
      remark: emptyToNull(parsed.remark ?? null),
      status: 'draft',
      reject_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (headErr) throwDbError(headErr, '更新费用报销单');

  const { error: delErr } = await supabase.from(ITEM_TABLE).delete().eq('claim_id', id);
  if (delErr) throwDbError(delErr, '清理旧费用明细');
  const { error: itemsErr } = await supabase.from(ITEM_TABLE).insert(computed);
  if (itemsErr) throwDbError(itemsErr, '写入费用明细');

  return getExpenseDetail(id);
}

/** 删除报销单（仅 draft） */
export async function deleteExpense(id: string): Promise<void> {
  const row = await loadClaim(id);
  if (row.status !== 'draft') throw new ApiError(400, 'FIN.BAD_TRANSITION', '仅草稿报销单可删除');
  const supabase = getSupabaseClient();
  const { error } = await supabase.from(CLAIM_TABLE).delete().eq('id', id);
  if (error) throwDbError(error, '删除费用报销单');
}

/** 提交审批（draft/rejected → pending，按含税金额分级） */
export async function submitExpense(id: string, user: SysUser): Promise<ExpenseClaimDetail> {
  const row = await loadClaim(id);
  if (row.status !== 'draft' && row.status !== 'rejected') {
    throw new ApiError(400, 'FIN.BAD_TRANSITION', '仅草稿或已驳回的报销单可提交');
  }
  const amount = Number(row.total_amount ?? 0);
  if (amount <= 0) throw new ApiError(400, 'FIN.EMPTY_AMOUNT', '报销单金额必须大于 0');
  await submitDocument('expense', id, amount, user);
  return getExpenseDetail(id);
}

/**
 * 审批通过当前步；若终审通过（状态=approved）生成费用确认凭证（幂等）。
 */
export async function approveExpense(id: string, user: SysUser, comment?: string): Promise<ExpenseClaimDetail> {
  await approveCurrentStep('expense', id, user, comment);
  const row = await loadClaim(id);
  if (row.status === 'approved') {
    await ensureExpenseVoucher(row, user);
  }
  return getExpenseDetail(id);
}

/** 生成费用确认凭证并回写 voucher_no（幂等） */
async function ensureExpenseVoucher(row: Record<string, unknown>, user: SysUser): Promise<void> {
  if (row.voucher_no) return;
  const id = row.id as string;
  const items = await loadItems(id);
  const creditAccount = (row.pay_account as string | null) ?? '2241';
  await onExpenseApprove({
    claim_id: id,
    claim_no: row.claim_no as string,
    applicant: row.applicant as string,
    items: items.map((it) => ({
      subject_code: it.subject_code,
      excl_amount: it.excl_amount,
      tax_amount: it.tax_amount,
      summary: it.summary ?? undefined,
    })),
    credit_account: creditAccount,
    credit_account_name: creditAccount === '2241' ? '其他应付款' : '银行存款',
    operatorId: user.id,
    date: row.claim_date ? String(row.claim_date).slice(0, 10) : undefined,
  });
  const supabase = getSupabaseClient();
  const { data: voucher } = await supabase
    .from('fin_vouchers')
    .select('voucher_no')
    .eq('event_type', 'expense_claim')
    .eq('event_id', id)
    .maybeSingle();
  const voucherNo = (voucher as { voucher_no?: string } | null)?.voucher_no ?? null;
  if (voucherNo) {
    await supabase.from(CLAIM_TABLE).update({ voucher_no: voucherNo }).eq('id', id);
  }
}

/** 驳回当前步（→ rejected） */
export async function rejectExpense(id: string, user: SysUser, reason: string): Promise<ExpenseClaimDetail> {
  await rejectCurrentStep('expense', id, user, reason);
  return getExpenseDetail(id);
}

/**
 * 付款：登记 fin_payments（payment）+ 生成付款凭证（借其他应付款 / 贷银行存款），幂等。
 * 仅 approved 可付款；付款后状态 → paid，回写 payment_id + 凭证号。
 */
export async function payExpense(
  id: string,
  user: SysUser,
  input: { method?: string; paid_at?: string; remark?: string } = {},
): Promise<ExpenseClaimDetail> {
  const row = await loadClaim(id);
  if (row.status !== 'approved') throw new ApiError(400, 'FIN.BAD_TRANSITION', '仅审核通过的报销单可付款');
  const amount = Number(row.total_amount ?? 0);
  const claimNo = row.claim_no as string;
  const applicant = row.applicant as string;
  const supabase = getSupabaseClient();

  const paidAt = input.paid_at ? String(input.paid_at).slice(0, 19).replace('T', ' ') : new Date().toISOString();
  const method = input.method ?? 'bank';

  const payNo = await nextDocNo('PY', 'fin_payments', 'doc_no');
  const { data: payRow, error: payErr } = await supabase
    .from('fin_payments')
    .insert({
      doc_no: payNo,
      direction: 'payment',
      amount: round2(amount),
      method,
      paid_at: paidAt,
      status: 'approved',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      remark: input.remark ?? `费用报销付款：${claimNo}`,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (payErr) throwDbError(payErr, '登记付款单');
  const paymentId = (payRow as { id: string }).id;

  await onExpensePay({
    claim_id: id,
    claim_no: claimNo,
    applicant,
    amount,
    debit_account: (row.pay_account as string | null) ?? '2241',
    operatorId: user.id,
    date: paidAt.slice(0, 10),
  });

  const { data: voucher } = await supabase
    .from('fin_vouchers')
    .select('voucher_no')
    .eq('event_type', 'expense_pay')
    .eq('event_id', id)
    .maybeSingle();
  void (voucher as { voucher_no?: string } | null)?.voucher_no;

  const { error: updErr } = await supabase
    .from(CLAIM_TABLE)
    .update({ status: 'paid', payment_id: paymentId, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (updErr) throwDbError(updErr, '更新报销单付款状态');

  return getExpenseDetail(id);
}
