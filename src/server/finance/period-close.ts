/**
 * 财务期末结账与年结（fin_accounting_periods / fin_period_logs）
 *
 * - 月结清单：getClosePeriods 聚合每个会计期间的状态/凭证数/借贷合计/试算平衡。
 * - 结转损益：closeProfit 把期间损益类科目余额结转至「本年利润(4103)」，凭证 (event_type,event_id) 幂等防重，借贷恒平衡。
 * - 期间锁定：closePeriod 将期间置 closed(锁定)；仅可反结账或红字冲消。
 * - 反结账留痕：reversePeriod 回退 open 并写不可删除日志 fin_period_logs（谁/何时/原因）。
 * - 年结：yearClose 顺带结清各月、结转本年利润→未分配利润，并把资产/负债/权益科目期末结转至次年期初。
 */
import { ApiError } from '@/server/http';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { throwDbError } from '@/server/master-data/helpers';
import { findVoucherByEvent, nextVoucherNo, EVENT_PERIOD_PROFIT_CLOSE, EVENT_YEAR_TO_RETAINED } from '@/server/ledger/ledger';
import { accountFlowsBetween, getSubjectBalances, getTrialBalance, loadSubjects } from '@/server/finance/subjects';
import { round2 } from '@/server/ledger/balance-math';

type VoucherDirection = 'd' | 'c';

interface LineInput {
  line_no: number;
  direction: VoucherDirection;
  account_code: string;
  account_name: string;
  amount: string;
  summary: string;
}

function periodRange(period: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new ApiError(400, 'FIN.BAD_PERIOD', '期间格式应为 YYYY-MM');
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, '0')}` };
}

function periodEndDate(period: string): string {
  const [, , to] = [null, null, periodRange(period).to];
  return to;
}

/** 本年利润科目编码 */
const RETAINED_EARNINGS = '4103';
const UNDISTRIBUTED = '4104';

/** 幂等生成「结转损益」凭证（损益类余额 → 本年利润）；无发生额返回 null */
export async function closeProfit(period: string, operatorId: string): Promise<{ id: string; voucher_no: string } | null> {
  const existing = await findVoucherByEvent(EVENT_PERIOD_PROFIT_CLOSE, period);
  if (existing) return { id: existing.id, voucher_no: existing.voucher_no };
  const { from, to } = periodRange(period);
  const flows = await accountFlowsBetween(from, to);
  if (flows.size === 0) return null;
  const subjects = await loadSubjects();
  const dict = new Map(subjects.map((s) => [s.subject_code, s]));
  const leafPnl = subjects.filter((s) => s.category === 6 && s.is_leaf);

  let incomeTotal = 0;   // 收入（贷方净值）
  let expenseTotal = 0;  // 费用（借方净值）
  const lines: LineInput[] = [];
  let no = 0;
  const addLine = (direction: VoucherDirection, account_code: string, amount: number, summary: string) => {
    if (amount <= 0) return;
    no += 1;
    lines.push({
      line_no: no,
      direction,
      account_code,
      account_name: dict.get(account_code)?.subject_name ?? account_code,
      amount: String(round2(amount)),
      summary,
    });
  };

  for (const s of leafPnl) {
    const f = flows.get(s.subject_code) ?? { debit: 0, credit: 0 };
    const creditNet = round2(f.credit - f.debit);
    const debitNet = round2(f.debit - f.credit);
    if (s.direction === 1) {
      // 收入/收益类：贷方余额 → 借记转出
      if (creditNet > 0) {
        addLine('d', s.subject_code, creditNet, `结转${s.subject_name}`);
        incomeTotal += creditNet;
      }
    } else {
      // 成本/费用类：借方余额 → 贷记转出
      if (debitNet > 0) {
        addLine('c', s.subject_code, debitNet, `结转${s.subject_name}`);
        expenseTotal += debitNet;
      }
    }
  }

  const net = round2(incomeTotal - expenseTotal);
  if (lines.length === 0 && Math.abs(net) < 0.01) return null; // 无可结转
  if (net >= 0) {
    addLine('c', RETAINED_EARNINGS, net, `结转本期损益至本年利润`);
  } else {
    addLine('d', RETAINED_EARNINGS, -net, `结转本期亏损至本年利润`);
  }
  const totalDebit = round2(lines.filter((l) => l.direction === 'd').reduce((s, l) => s + Number(l.amount), 0));
  const totalCredit = round2(lines.filter((l) => l.direction === 'c').reduce((s, l) => s + Number(l.amount), 0));
  if (Math.abs(totalDebit - totalCredit) > 0.01) throw new ApiError(500, 'FIN.UNBALANCED', '结转损益凭证借贷不平衡');

  const date = periodEndDate(period);
  const voucher_no = await nextVoucherNo(date);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fin_vouchers')
    .insert({
      voucher_no,
      voucher_date: date,
      event_type: EVENT_PERIOD_PROFIT_CLOSE,
      event_id: period,
      ref_no: null,
      ref_summary: `结转损益（${period}）`,
      template_code: 'period_profit_close',
      total_debit: String(totalDebit),
      total_credit: String(totalCredit),
      status: 'posted',
      source: 'auto',
      created_by: operatorId,
      posted_by: operatorId,
      posted_at: new Date().toISOString(),
    })
    .select()
    .maybeSingle();
  if (error) {
    if (error.message && /\bfin_vouchers_event_uniq\b/.test(error.message)) {
      const again = await findVoucherByEvent(EVENT_PERIOD_PROFIT_CLOSE, period);
      if (again) return { id: again.id, voucher_no: again.voucher_no };
    }
    throw new ApiError(500, 'DB', error.message);
  }
  const voucher = data as Record<string, unknown>;
  const { error: lineErr } = await supabase
    .from('fin_voucher_lines')
    .insert(lines.map((l) => ({ ...l, voucher_id: voucher.id })));
  if (lineErr) throw new ApiError(500, 'DB', `结转损益分录写入失败：${lineErr.message}`);

  await logPeriod(period, 'profit_close', operatorId, undefined, voucher_no);
  return { id: voucher.id as string, voucher_no: voucher.voucher_no as string };
}

async function ensurePeriod(period: string): Promise<Record<string, unknown>> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fin_accounting_periods').select('*').eq('period', period).maybeSingle();
  if (error) throwDbError(error, '查询期间');
  if (data) return data as Record<string, unknown>;
  const { data: ins, error: insErr } = await supabase
    .from('fin_accounting_periods').insert({ period, status: 'open', locked: false }).select().maybeSingle();
  if (insErr) throwDbError(insErr, '创建期间');
  return (ins ?? { period }) as Record<string, unknown>;
}

async function logPeriod(period: string, action: string, actor: string | undefined, reason?: string, ref?: string, payload?: unknown) {
  const supabase = getSupabaseClient();
  await supabase.from('fin_period_logs').insert({ period, action, actor, reason: reason ?? null, ref_voucher_no: ref ?? null, payload: payload ?? null });
}

export interface PeriodCloseItem {
  period: string;
  status: string;
  locked: boolean;
  year_end: boolean;
  profit_close_voucher_no: string | null;
  voucher_count: number;
  total_debit: number;
  total_credit: number;
  balanced: boolean;
  closed_by: string | null;
  closed_at: string | null;
  reversed_reason: string | null;
}

/** 月结清单：各会计期间状态 + 本期凭证数/借贷合计/试算平衡 */
export async function getClosePeriods(): Promise<PeriodCloseItem[]> {
  const supabase = getSupabaseClient();
  const { data: rows, error } = await supabase
    .from('fin_accounting_periods').select('*').order('period', { ascending: false });
  if (error) throwDbError(error, '查询期间清单');
  const items: PeriodCloseItem[] = [];
  for (const r of (rows ?? []) as Record<string, unknown>[]) {
    const period = r.period as string;
    const tb = await getTrialBalance(period);
    // 凭证数
    const { count, error: cErr } = await supabase
      .from('fin_vouchers').select('id', { count: 'exact', head: true })
      .eq('status', 'posted').gte('voucher_date', periodRange(period).from).lte('voucher_date', periodRange(period).to);
    if (cErr) throwDbError(cErr, '统计凭证数');
    items.push({
      period,
      status: r.status as string,
      locked: Boolean(r.locked),
      year_end: Boolean(r.year_end),
      profit_close_voucher_no: (r.profit_close_voucher_no as string | null) ?? null,
      voucher_count: count ?? 0,
      total_debit: tb.total_debit,
      total_credit: tb.total_credit,
      balanced: tb.balanced,
      closed_by: (r.closed_by as string | null) ?? null,
      closed_at: (r.closed_at as string | null) ?? null,
      reversed_reason: (r.reversed_reason as string | null) ?? null,
    });
  }
  return items;
}

/** 期间结账：先结转损益，再锁定期间 open→closed，写日志 */
export async function closePeriod(period: string, operatorId: string): Promise<{ period: string; profit_close: string | null }> {
  const row = await ensurePeriod(period);
  if ((row.status as string) !== 'open') throw new ApiError(400, 'FIN.PERIOD_NOT_OPEN', '该期间已结账或非 open，无法重复结账');
  const profit = await closeProfit(period, operatorId);
  const patch: Record<string, unknown> = {
    status: 'closed',
    locked: true,
    closed_by: operatorId,
    closed_at: new Date().toISOString(),
    profit_close_voucher_no: profit?.voucher_no ?? null,
    profit_close_voucher_id: profit?.id ?? null,
    updated_at: new Date().toISOString(),
  };
  const supabase = getSupabaseClient();
  const { error } = await supabase.from('fin_accounting_periods').update(patch).eq('period', period);
  if (error) throwDbError(error, '锁定期间');
  await logPeriod(period, 'close', operatorId, undefined, profit?.voucher_no, { status: 'closed' });
  return { period, profit_close: profit?.voucher_no ?? null };
}

/** 反结账留痕：closed→open，记录谁/何时/原因，日志不可删除 */
export async function reversePeriod(period: string, operatorId: string, reason: string): Promise<{ period: string }> {
  const row = await ensurePeriod(period);
  if ((row.status as string) !== 'closed') throw new ApiError(400, 'FIN.PERIOD_NOT_CLOSED', '仅已结账期间可反结账');
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from('fin_accounting_periods')
    .update({
      status: 'open',
      locked: false,
      reversed_by: operatorId,
      reversed_at: new Date().toISOString(),
      reversed_reason: reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('period', period);
  if (error) throwDbError(error, '反结账');
  await logPeriod(period, 'reopen', operatorId, reason, undefined, { from: 'closed', to: 'open' });
  return { period };
}

/** 期间日志（留痕，只读查询） */
export async function getPeriodLogs(period: string): Promise<Record<string, unknown>[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fin_period_logs').select('*').eq('period', period).order('happened_at', { ascending: false });
  if (error) throwDbError(error, '查询期间日志');
  return (data ?? []) as Record<string, unknown>[];
}

/** 年末结账：顺带结清各月 → 结转本年利润→未分配利润 → 资产/负债/权益结转次年期初 */
export async function yearClose(year: string, operatorId: string): Promise<{ year: string; months_closed: number; retained: string | null }> {
  if (!/^\d{4}$/.test(year)) throw new ApiError(400, 'FIN.BAD_YEAR', '年份格式应为 YYYY');
  let monthsClosed = 0;
  for (let m = 1; m <= 12; m += 1) {
    const period = `${year}-${String(m).padStart(2, '0')}`;
    const row = await ensurePeriod(period);
    if ((row.status as string) === 'open') {
      await closePeriod(period, operatorId);
      monthsClosed += 1;
    }
  }

  // 本年利润 → 未分配利润（幂等）
  const existingRetained = await findVoucherByEvent(EVENT_YEAR_TO_RETAINED, year);
  let retained: { id: string; voucher_no: string } | null = existingRetained ? { id: existingRetained.id, voucher_no: existingRetained.voucher_no } : null;
  if (!existingRetained) {
    const recompute = await computeYearNetProfit(year);
    if (Math.abs(recompute.net) >= 0.01) {
      retained = await createRetainedVoucher(year, recompute);
    }
  }

  // 资产/负债/权益/本年利润 期末结转次年期初
  const supabase = getSupabaseClient();
  const { rows: decRows } = await getSubjectBalances(`${year}-12`);
  const subjects = await loadSubjects();
  const dict = new Map(subjects.map((s) => [s.subject_code, s]));
  for (const r of decRows) {
    const s = dict.get(r.subject_code);
    if (!s || s.category > 4 || !s.is_leaf) continue;
    if (s.subject_code === RETAINED_EARNINGS) {
      await supabase.from('fin_subjects').update({ opening_amount: 0, opening_direction: 0, updated_at: new Date().toISOString() }).eq('subject_code', r.subject_code);
      continue;
    }
    const closing = r.closing; // 带方向符号
    if (s.category === 4 && (s.subject_code === UNDISTRIBUTED || s.subject_code === RETAINED_EARNINGS)) continue;
    await supabase
      .from('fin_subjects')
      .update({ opening_amount: Math.abs(round2(closing)), opening_direction: closing >= 0 ? 0 : 1, updated_at: new Date().toISOString() })
      .eq('subject_code', r.subject_code);
  }
  // 未分配利润期初累加上本年留存
  if (retained) {
    const gainRow = decRows.find((r) => r.subject_code === UNDISTRIBUTED);
    const base = gainRow ? Math.abs(gainRow.closing) : 0;
    const { net: retainedNet } = await computeYearNetProfit(year);
    const nextOpening = round2(base + retainedNet);
    await supabase
      .from('fin_subjects')
      .update({
        opening_amount: Math.abs(nextOpening),
        opening_direction: nextOpening >= 0 ? 0 : 1,
        updated_at: new Date().toISOString(),
      })
      .eq('subject_code', UNDISTRIBUTED);
  }

  // 标记期间 annual_closed
  for (let m = 1; m <= 12; m += 1) {
    const period = `${year}-${String(m).padStart(2, '0')}`;
    await supabase.from('fin_accounting_periods').update({ status: 'annual_closed', year_end: true, updated_at: new Date().toISOString() }).eq('period', period);
    await logPeriod(period, 'year_close', operatorId, `年结 元 （${year}）`, retained?.voucher_no, { year });
  }

  return { year, months_closed: monthsClosed, retained: retained?.voucher_no ?? null };
}

async function computeYearNetProfit(year: string): Promise<{ net: number }> {
  const flows = await accountFlowsBetween(`${year}-01-01`, `${year}-12-31`);
  const subjects = await loadSubjects();
  const leafPnl = subjects.filter((s) => s.category === 6 && s.is_leaf);
  let incomeTotal = 0;
  let expenseTotal = 0;
  for (const s of leafPnl) {
    const f = flows.get(s.subject_code) ?? { debit: 0, credit: 0 };
    if (s.direction === 1) incomeTotal += Math.max(0, round2(f.credit - f.debit));
    else expenseTotal += Math.max(0, round2(f.debit - f.credit));
  }
  return { net: round2(incomeTotal - expenseTotal) };
}

async function createRetainedVoucher(year: string, calc: { net: number }): Promise<{ id: string; voucher_no: string }> {
  const { net } = calc;
  const supabase = getSupabaseClient();
  const subjects = await loadSubjects();
  const dict = new Map(subjects.map((s) => [s.subject_code, s]));
  const date = `${year}-12-31`;
  const lines: LineInput[] = [];
  if (net >= 0) {
    lines.push({ line_no: 1, direction: 'd', account_code: RETAINED_EARNINGS, account_name: dict.get(RETAINED_EARNINGS)?.subject_name ?? RETAINED_EARNINGS, amount: String(round2(net)), summary: `年结转本年利润至未分配利润` });
    lines.push({ line_no: 2, direction: 'c', account_code: UNDISTRIBUTED, account_name: dict.get(UNDISTRIBUTED)?.subject_name ?? UNDISTRIBUTED, amount: String(round2(net)), summary: `年结转本年利润至未分配利润` });
  } else {
    lines.push({ line_no: 1, direction: 'c', account_code: RETAINED_EARNINGS, account_name: dict.get(RETAINED_EARNINGS)?.subject_name ?? RETAINED_EARNINGS, amount: String(-round2(net)), summary: `年结转亏损至未分配利润` });
    lines.push({ line_no: 2, direction: 'd', account_code: UNDISTRIBUTED, account_name: dict.get(UNDISTRIBUTED)?.subject_name ?? UNDISTRIBUTED, amount: String(-round2(net)), summary: `年结转亏损至未分配利润` });
  }
  const totalDebit = round2(lines.filter((l) => l.direction === 'd').reduce((s, l) => s + Number(l.amount), 0));
  const totalCredit = round2(lines.filter((l) => l.direction === 'c').reduce((s, l) => s + Number(l.amount), 0));
  const voucher_no = await nextVoucherNo(date);
  const { data, error } = await supabase
    .from('fin_vouchers')
    .insert({
      voucher_no,
      voucher_date: date,
      event_type: EVENT_YEAR_TO_RETAINED,
      event_id: year,
      ref_no: null,
      ref_summary: `年结：本年利润转入未分配利润（${year}）`,
      template_code: 'year_to_retained',
      total_debit: String(totalDebit),
      total_credit: String(totalCredit),
      status: 'posted',
      source: 'auto',
      created_by: null,
      posted_by: null,
      posted_at: new Date().toISOString(),
    })
    .select()
    .maybeSingle();
  if (error) {
    if (error.message && /\bfin_vouchers_event_uniq\b/.test(error.message)) {
      const again = await findVoucherByEvent(EVENT_YEAR_TO_RETAINED, year);
      if (again) return { id: again.id, voucher_no: again.voucher_no };
    }
    throw new ApiError(500, 'DB', error.message);
  }
  const voucher = data as Record<string, unknown>;
  const { error: lineErr } = await supabase.from('fin_voucher_lines').insert(lines.map((l) => ({ ...l, voucher_id: voucher.id })));
  if (lineErr) throw new ApiError(500, 'DB', `年结分录写入失败：${lineErr.message}`);
  return { id: voucher.id as string, voucher_no: voucher.voucher_no as string };
}