/**
 * 财务凭证引擎（fin_ ledger）
 * - 模板驱动：fin_voucher_templates.SPEC 定义借贷分录，expr 令牌求值
 * - 幂等：event_type+event_id 联合唯一，同一业务事件只生成一套凭证
 * - 借贷平衡：生成器保证 总借=总贷（尾差归入模板 balance_to 科目）
 * - 红冲：仅已过账凭证可红字冲销作废，不破坏性删除已过账凭证
 */
import { ApiError } from "@/server/http";
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { ensureLeafCodes } from "@/server/finance/leaf-guard";

export const EVENT_SALES_SHIPMENT = 'sales_shipment';
export const EVENT_PURCHASE_RECEIPT = 'purchase_receipt';
export const EVENT_RECEIPT_SETTLE = 'receipt_settle';
export const EVENT_PAYMENT_SETTLE = 'payment_settle';
export const EVENT_RECEIPT_REVERSE = 'receipt_reverse';
export const EVENT_SALES_SHIPMENT_COST = 'sales_cof_shipment';
export const EVENT_MANUFACTURE_FINISH = 'manufacture_finish';

export type VoucherDirection = 'd' | 'c';
export interface VoucherLine {
  direction: VoucherDirection;
  account_code: string;
  account_name: string;
  amount: number;
  summary?: string;
}
export interface VoucherTemplateSpec {
  dc: VoucherDirection;
  account: string;
  account_name: string;
  expr: string;
  summary?: string;
}
export interface LedgerCtx {
  /** 含税总额 */
  amount: number;
  /** 不含税总额 */
  excl?: number;
  /** 税额 */
  tax?: number;
  /** 暂估含税额（用于红蓝冲回红字） */
  est?: number;
}
export interface VoucherLineDB {
  line_no: number;
  direction: string;
  account_code: string;
  account_name: string;
  amount: string;
  summary?: string | null;
}

export interface TemplateRow {
  template_code: string;
  name: string;
  event_type: string;
  spec: VoucherTemplateSpec[];
  balance_to?: { account: string; account_name: string; summary?: string } | null;
}

/** 按商品税率把含税总额拆分为 不含税 + 税额（价内税相当：tax = amount * r / (100 + r)） */
export function splitAmountWithRate(amount: number, rate: number): { excl: number; tax: number } {
  if (rate <= 0) return { excl: round2(amount), tax: 0 };
  const tax = round2((amount * rate) / (100 + rate));
  return { excl: round2(amount - tax), tax };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const TOKEN_FN: Record<string, (c: LedgerCtx) => number> = {
  '#amount': (c) => c.amount,
  '#excl': (c) => c.excl ?? 0,
  '#tax': (c) => c.tax ?? 0,
  '#est': (c) => c.est ?? 0,
  '#neg_est': (c) => -(c.est ?? 0),
};

/**
 * 根据模板+上下文生成借贷分录（纯函数，供 golden set 直接回归）。
 * 保证 总借=总贷；尾差归入模板 balance_to 科目，未配置且不平衡则抛错。
 */
export function buildVoucherEntries(template: TemplateRow, ctx: LedgerCtx): {
  lines: VoucherLineDB[];
  total_debit: number;
  total_credit: number;
} {
  const lines: VoucherLine[] = template.spec.map((s) => ({
    direction: s.dc,
    account_code: s.account,
    account_name: s.account_name,
    amount: (TOKEN_FN[s.expr] ?? (() => 0))(ctx),
    summary: s.summary,
  }));

  const sumD = round2(lines.filter((l) => l.direction === 'd').reduce((a, l) => a + l.amount, 0));
  const sumC = round2(lines.filter((l) => l.direction === 'c').reduce((a, l) => a + l.amount, 0));
  const diff = round2(sumD - sumC);

  const finalLines = lines.map((l) => ({
    line_no: 0,
    direction: l.direction,
    account_code: l.account_code,
    account_name: l.account_name,
    amount: String(l.amount.toFixed(2)),
    summary: l.summary ?? null,
  }));

  let totalD = sumD;
  let totalC = sumC;
  if (diff !== 0) {
    if (Math.abs(diff) > 0.5) {
      throw new ApiError(400, 'LEDGER.UNBALANCED', `凭证借贷不平衡（借 ${sumD} ≠ 贷 ${sumC}）`);
    }
    if (!template.balance_to) {
      throw new ApiError(400, 'LEDGER.UNBALANCED', `凭证借贷不平衡且模板未配置尾差科目（借 ${sumD} ≠ 贷 ${sumC}）`);
    }
    // 借多则补贷，贷多则补借
    const dir: VoucherDirection = diff > 0 ? 'c' : 'd';
    finalLines.push({
      line_no: 0,
      direction: dir,
      account_code: template.balance_to.account,
      account_name: template.balance_to.account_name,
      amount: String(Math.abs(diff).toFixed(2)),
      summary: template.balance_to.summary ?? '尾差调整',
    });
    if (dir === 'c') totalC = round2(totalC + Math.abs(diff));
    else totalD = round2(totalD + Math.abs(diff));
  }

  finalLines.forEach((l, i) => (l.line_no = i + 1));
  return { lines: finalLines, total_debit: totalD, total_credit: totalC };
}

interface VoucherInput {
  event_type: string;
  event_id: string;
  voucher_date: string;
  ref_no?: string;
  ref_summary?: string;
  template_code: string;
  ctx: LedgerCtx;
  operatorId: string;
}

async function nextVoucherNo(date: string): Promise<string> {
  const supabase = getSupabaseClient();
  const prefix = `记-${date}-`;
  const { data, error } = await supabase
    .from('fin_vouchers')
    .select('voucher_no')
    .like('voucher_no', `${prefix}%`);
  if (error) throw new ApiError(500, 'DB', error.message);
  const max = (data ?? []).reduce((acc, v) => {
    const m = /-(\d{4})$/.exec(v.voucher_no);
    return m ? Math.max(acc, Number(m[1])) : acc;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

async function loadTemplate(eventType: string): Promise<TemplateRow> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fin_voucher_templates')
    .select('*')
    .eq('event_type', eventType)
    .maybeSingle();
  if (error) throw new ApiError(500, 'DB', error.message);
  if (!data) throw new ApiError(400, 'LEDGER.NO_TEMPLATE', `未配置凭证模板：${eventType}`);
  return data as unknown as TemplateRow;
}

export interface VoucherView {
  id: string;
  voucher_no: string;
  voucher_date: string;
  event_type: string;
  event_id: string;
  ref_no: string | null;
  ref_summary: string | null;
  template_code: string;
  total_debit: string;
  total_credit: string;
  status: string;
  source: string;
  void_of_no: string | null;
  created_by: string | null;
  created_at: string;
  posted_at: string | null;
  void_by: string | null;
  void_at: string | null;
  void_remark: string | null;
  lines: VoucherLineDB[];
}

function mapVoucher(row: Record<string, unknown>, lines: VoucherLineDB[]): VoucherView {
  return {
    id: row.id as string,
    voucher_no: row.voucher_no as string,
    voucher_date: row.voucher_date as string,
    event_type: row.event_type as string,
    event_id: row.event_id as string,
    ref_no: (row.ref_no as string) ?? null,
    ref_summary: (row.ref_summary as string) ?? null,
    template_code: row.template_code as string,
    total_debit: String(row.total_debit),
    total_credit: String(row.total_credit),
    status: row.status as string,
    source: row.source as string,
    void_of_no: (row.void_of_no as string) ?? null,
    created_by: (row.created_by as string) ?? null,
    created_at: row.created_at as string,
    posted_at: (row.posted_at as string) ?? null,
    void_by: (row.void_by as string) ?? null,
    void_at: (row.void_at as string) ?? null,
    void_remark: (row.void_remark as string) ?? null,
    lines,
  };
}

async function fetchLines(voucherId: string): Promise<VoucherLineDB[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fin_voucher_lines')
    .select('line_no, direction, account_code, account_name, amount, summary')
    .eq('voucher_id', voucherId)
    .order('line_no', { ascending: true });
  if (error) throw new ApiError(500, 'DB', error.message);
  return (data ?? []) as unknown as VoucherLineDB[];
}

/** 幂等生成凭证：同一 event 已存在则返回既有 */
export async function ensureVoucher(input: VoucherInput): Promise<VoucherView> {
  const supabase = getSupabaseClient();
  // 幂等：已有则返回
  const existing = await findVoucherByEvent(input.event_type, input.event_id);
  if (existing) return existing;

  const template = await loadTemplate(input.event_type);
  const { lines, total_debit, total_credit } = buildVoucherEntries(template, input.ctx);
  const voucher_no = await nextVoucherNo(input.voucher_date);

  const { data, error } = await supabase
    .from('fin_vouchers')
    .insert({
      voucher_no,
      voucher_date: input.voucher_date,
      event_type: input.event_type,
      event_id: input.event_id,
      ref_no: input.ref_no ?? null,
      ref_summary: input.ref_summary ?? null,
      template_code: input.template_code,
      total_debit: String(total_debit),
      total_credit: String(total_credit),
      status: 'posted',
      source: 'auto',
      created_by: input.operatorId,
      posted_by: input.operatorId,
      posted_at: new Date().toISOString(),
    })
    .select()
    .maybeSingle();
  if (error) {
    // 并发重复：event 唯一约束命中 → 视为幂等已有
    if (error.message && /\bfin_vouchers_event_uniq\b/.test(error.message)) {
      const again = await findVoucherByEvent(input.event_type, input.event_id);
      if (again) return again;
    }
    throw new ApiError(500, 'DB', error.message);
  }
  const voucher = data as Record<string, unknown>;
  const { error: lineErr } = await supabase.from('fin_voucher_lines').insert(
    lines.map((l) => ({ ...l, voucher_id: voucher.id })),
  );
  if (lineErr) throw new ApiError(500, 'DB', `凭证分录写入失败：${lineErr.message}`);
  return mapVoucher(voucher, lines);
}

export async function findVoucherByEvent(eventType: string, eventId: string): Promise<VoucherView | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fin_vouchers')
    .select('*')
    .eq('event_type', eventType)
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw new ApiError(500, 'DB', error.message);
  if (!data) return null;
  const lines = await fetchLines(data.id as string);
  return mapVoucher(data as Record<string, unknown>, lines);
}

export interface VoucherListQuery {
  page?: number;
  page_size?: number;
  keyword?: string;
  status?: string;
  event_type?: string;
  from?: string;
  to?: string;
  /** 会计期间 YYYY-MM */
  period?: string;
  /** 按分录科目编码过滤 */
  account_code?: string;
}

function periodRangeForQuery(period: string): { from: string; to: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new ApiError(400, 'LEDGER.BAD_PERIOD', '期间格式应为 YYYY-MM');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const lastDay = new Date(y, mo, 0).getDate();
  return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, '0')}` };
}

export async function listVouchers(query: VoucherListQuery = {}): Promise<{
  items: VoucherView[];
  total: number;
  page: number;
  page_size: number;
}> {
  const supabase = getSupabaseClient();
  const page = query.page && query.page > 0 ? query.page : 1;
  const pageSize = Math.min(query.page_size && query.page_size > 0 ? query.page_size : 20, 100);
  let q = supabase.from('fin_vouchers').select('*', { count: 'exact' });
  if (query.status) q = q.eq('status', query.status);
  if (query.event_type) q = q.eq('event_type', query.event_type);
  if (query.from) q = q.gte('voucher_date', query.from);
  if (query.to) q = q.lte('voucher_date', query.to);
  if (query.period) {
    const { from, to } = periodRangeForQuery(query.period);
    q = q.gte('voucher_date', from).lte('voucher_date', to);
  }
  if (query.keyword) q = q.or(`voucher_no.ilike.%${query.keyword}%,ref_no.ilike.%${query.keyword}%,ref_summary.ilike.%${query.keyword}%`);
  // 按分录科目过滤：先查含该科目的凭证 id 集合，再 in 过滤
  if (query.account_code) {
    const { data: hitLines, error: hitErr } = await supabase
      .from('fin_voucher_lines')
      .select('voucher_id')
      .eq('account_code', query.account_code);
    if (hitErr) throw new ApiError(500, 'DB', hitErr.message);
    const ids = (hitLines ?? []).map((l) => l.voucher_id as string);
    if (ids.length === 0) return { items: [], total: 0, page, page_size: pageSize };
    q = q.in('id', ids);
  }
  const { data, error, count } = await q
    .order('voucher_date', { ascending: false })
    .order('voucher_no', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);
  if (error) throw new ApiError(500, 'DB', error.message);
  const items: VoucherView[] = [];
  for (const row of data ?? []) {
    const r = row as Record<string, unknown>;
    const lines = await fetchLines(r.id as string);
    items.push(mapVoucher(r, lines));
  }
  return { items, total: count ?? items.length, page, page_size: pageSize };
}

export async function getVoucher(id: string): Promise<VoucherView> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fin_vouchers').select('*').eq('id', id).maybeSingle();
  if (error) throw new ApiError(500, 'DB', error.message);
  if (!data) throw new ApiError(404, 'NOT_FOUND', '凭证不存在');
  const lines = await fetchLines(id);
  return mapVoucher(data as Record<string, unknown>, lines);
}

/**
 * 删除凭证：仅允许删除未过账（draft）凭证；已过账需走红字冲销。
 */
export async function deleteVoucher(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const v = await getVoucher(id);
  if (v.status !== 'draft') {
    throw new ApiError(400, 'LEDGER.BAD_TRANSITION', '仅未过账凭证可删除，已过账请用红字冲销');
  }
  const { error } = await supabase.from('fin_vouchers').delete().eq('id', id);
  if (error) throw new ApiError(500, 'DB', error.message);
}

/**
 * 红字冲销：对已过账(或未过账)凭证作废。
 * - posted → 生成一张反向红字冲销凭证并置原凭证为 void
 * - draft  → 直接作废（不生成红冲）
 */
export async function voidVoucher(id: string, user: { id: string }, reason: string): Promise<VoucherView> {
  const supabase = getSupabaseClient();
  const v = await getVoucher(id);
  if (v.status === 'void') throw new ApiError(400, 'LEDGER.BAD_TRANSITION', '凭证已作废，请勿重复操作');

  if (v.status === 'draft') {
    const { error } = await supabase
      .from('fin_vouchers')
      .update({ status: 'void', void_by: user.id, void_at: new Date().toISOString(), void_remark: reason })
      .eq('id', id);
    if (error) throw new ApiError(500, 'DB', error.message);
    return getVoucher(id);
  }

  // 已过账：生成红冲凭证（反向分录）
  const voucherNo = await nextVoucherNo(v.voucher_date);
  const redLines: VoucherLineDB[] = v.lines.map((l, i) => ({
    line_no: i + 1,
    direction: l.direction === 'd' ? 'c' : 'd',
    account_code: l.account_code,
    account_name: l.account_name,
    amount: l.amount,
    summary: `红冲${v.voucher_no}${l.summary ? '：' + l.summary : ''}`,
  }));
  const redTotal = v.total_debit;
  const { data: red, error: redErr } = await supabase
    .from('fin_vouchers')
    .insert({
      voucher_no: voucherNo,
      voucher_date: v.voucher_date,
      event_type: 'void',
      event_id: v.id,
      ref_no: v.ref_no,
      ref_summary: `红字冲销${v.voucher_no}（${reason || '作废'}）`,
      template_code: v.template_code,
      total_debit: String(redTotal),
      total_credit: String(redTotal),
      status: 'posted',
      source: 'auto',
      created_by: user.id,
      posted_by: user.id,
      posted_at: new Date().toISOString(),
      void_of_no: v.voucher_no,
    })
    .select()
    .maybeSingle();
  if (redErr) throw new ApiError(500, 'DB', redErr.message);
  const { error: lineErr } = await supabase.from('fin_voucher_lines').insert(
    redLines.map((l) => ({ ...l, voucher_id: (red as Record<string, unknown>).id })),
  );
  if (lineErr) throw new ApiError(500, 'DB', `红冲分录写入失败：${lineErr.message}`);

  // 原凭证置 void
  const { error: updErr } = await supabase
    .from('fin_vouchers')
    .update({ status: 'void', void_of_no: voucherNo, void_by: user.id, void_at: new Date().toISOString(), void_remark: reason || null })
    .eq('id', id);
  if (updErr) throw new ApiError(500, 'DB', updErr.message);
  return getVoucher(id);
}

export interface ManualVoucherLineInput {
  direction: 'd' | 'c';
  account_code: string;
  summary?: string;
  amount: number;
}

/**
 * 手工凭证（草稿）：录入借贷分录，校验借贷平衡 + 科目均末级且启用。
 * 生成 draft 状态凭证，待过账。
 */
export async function createManualDraftVoucher(
  input: { voucher_date: string; ref_summary?: string; lines: ManualVoucherLineInput[] },
  operator: { id: string },
): Promise<VoucherView> {
  const supabase = getSupabaseClient();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.voucher_date)) throw new ApiError(400, 'LEDGER.BAD_DATE', '凭证日期格式应为 YYYY-MM-DD');
  if (!input.lines || input.lines.length < 2) throw new ApiError(400, 'LEDGER.INVALID_LINES', '凭证至少需要两条分录');
  for (const l of input.lines) {
    if (l.amount == null || !(l.amount > 0)) throw new ApiError(400, 'LEDGER.INVALID_AMOUNT', '分录金额必须大于0');
    if (!l.account_code) throw new ApiError(400, 'LEDGER.INVALID_ACCOUNT', '分录缺少科目编码');
  }
  await ensureLeafCodes(input.lines.map((l) => l.account_code));
  const sumD = round2(input.lines.filter((l) => l.direction === 'd').reduce((a, l) => a + l.amount, 0));
  const sumC = round2(input.lines.filter((l) => l.direction === 'c').reduce((a, l) => a + l.amount, 0));
  if (Math.abs(sumD - sumC) > 0.01) throw new ApiError(400, 'LEDGER.UNBALANCED', `凭证借贷不平衡（借 ${sumD} ≠ 贷 ${sumC}）`);
  const voucherNo = await nextVoucherNo(input.voucher_date);
  const { data, error } = await supabase
    .from('fin_vouchers')
    .insert({
      voucher_no: voucherNo,
      voucher_date: input.voucher_date,
      event_type: 'manual',
      event_id: voucherNo,
      ref_no: null,
      ref_summary: input.ref_summary || null,
      template_code: 'MANUAL',
      total_debit: String(sumD),
      total_credit: String(sumC),
      status: 'draft',
      source: 'manual',
      created_by: operator.id,
    })
    .select()
    .maybeSingle();
  if (error) throw new ApiError(500, 'DB', error.message);
  const vId = (data as Record<string, unknown>).id as string;
  const lines: VoucherLineDB[] = input.lines.map((l, i) => ({
    line_no: i + 1,
    direction: l.direction,
    account_code: l.account_code,
    account_name: '',
    amount: l.amount.toFixed(2),
    summary: l.summary || null,
  }));
  // 补科目名称
  const codes = [...new Set(lines.map((l) => l.account_code))];
  const { data: subs, error: subErr } = await supabase.from('fin_subjects').select('subject_code, subject_name').in('subject_code', codes);
  if (subErr) throw new ApiError(500, 'DB', subErr.message);
  const nameMap = new Map((subs ?? []).map((s) => [s.subject_code, s.subject_name]));
  lines.forEach((l) => {
    if (!l.account_name) l.account_name = (nameMap.get(l.account_code) as string) ?? l.account_code;
  });
  const { error: lineErr } = await supabase.from('fin_voucher_lines').insert(lines.map((l) => ({ ...l, voucher_id: vId })));
  if (lineErr) throw new ApiError(500, 'DB', `分录写入失败：${lineErr.message}`);
  return getVoucher(vId);
}

/** 手工凭证过账：draft → posted（锁定，后续需红冲） */
export async function postVoucher(id: string, operator: { id: string }): Promise<VoucherView> {
  const supabase = getSupabaseClient();
  const v = await getVoucher(id);
  if (v.status !== 'draft') throw new ApiError(400, 'LEDGER.BAD_TRANSITION', '仅草稿凭证可过账');
  const { error } = await supabase
    .from('fin_vouchers')
    .update({ status: 'posted', posted_by: operator.id, posted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw new ApiError(500, 'DB', error.message);
  return getVoucher(id);
}