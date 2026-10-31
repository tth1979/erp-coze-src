/**
 * 银行对账（fin_bank_statements）
 *
 * - 日记账（book）：由既有 fin_payments（已核销 approved 的收/付款）按银行账户归集，
 *   手续费/报销付款均以 fin_payments 落地，故日记账与收付款/报销天然联动。
 * - 对账单（bank）：import 导入 / manual 手工录入，带 matched_status。
 * - 自动匹配：调用纯函数 matchStatements（同账户+同方向+金额相等+日期临近，一对一）。
 * - 未达账项调节表：book/bank 各自全量净余额 + 未匹配净额 → reconcile。
 */
import { z } from 'zod';
import { ApiError } from '@/server/http';
import { emptyToNull, escapeOrKeyword, parseListQuery, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { matchStatements, reconcile, netBalance, type ReconLine, type ReconciliationView, type MatchResult } from '@/server/finance/bank-math';
import type { SysUser } from '@/storage/database/shared/schema';

const STMT_TABLE = 'fin_bank_statements';
/** 日记账统一归集账户（fin_payments 未区分银行账号，统一挂基本户） */
export const DEFAULT_BANK_ACCOUNT = '基本户(1002 银行存款)';

export interface BankStatementView {
  id: string;
  bank_account: string;
  tran_date: string;
  direction: 'in' | 'out';
  amount: number;
  summary: string | null;
  balance: number | null;
  matched_status: 'unmatched' | 'matched';
  matched_ref_type: string | null;
  matched_ref_id: string | null;
  matched_ref_no: string | null;
  source: string;
  remark: string | null;
  created_at: string;
}

export interface JournalLineView extends ReconLine {
  doc_no: string;
  method: string | null;
  matched: boolean;
}

const stmtCreateSchema = z.object({
  bank_account: z.string().trim().max(64).optional().nullable(),
  tran_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '交易日期格式应为 YYYY-MM-DD'),
  direction: z.enum(['in', 'out']),
  amount: z.number().positive('金额必须大于 0'),
  summary: z.string().trim().max(255).optional().nullable(),
  balance: z.number().optional().nullable(),
  remark: z.string().trim().max(500).optional().nullable(),
});
type StmtCreateInput = z.infer<typeof stmtCreateSchema>;

function mapStmt(row: Record<string, unknown>): BankStatementView {
  return {
    id: row.id as string,
    bank_account: row.bank_account as string,
    tran_date: String(row.tran_date ?? '').slice(0, 10),
    direction: row.direction as 'in' | 'out',
    amount: Number(row.amount ?? 0),
    summary: (row.summary as string | null) ?? null,
    balance: row.balance === null || row.balance === undefined ? null : Number(row.balance),
    matched_status: row.matched_status as 'unmatched' | 'matched',
    matched_ref_type: (row.matched_ref_type as string | null) ?? null,
    matched_ref_id: (row.matched_ref_id as string | null) ?? null,
    matched_ref_no: (row.matched_ref_no as string | null) ?? null,
    source: row.source as string,
    remark: (row.remark as string | null) ?? null,
    created_at: String(row.created_at ?? ''),
  };
}

/** 对账单分页列表 */
export async function listBankStatements(
  query: ListQuery,
  filter: { account?: string; matched?: string } = {},
): Promise<PagedResult<BankStatementView>> {
  const supabase = getSupabaseClient();
  let builder = supabase.from(STMT_TABLE).select('*', { count: 'exact' }).order('tran_date', { ascending: false }).order('created_at', { ascending: false });
  if (filter.account) builder = builder.eq('bank_account', filter.account);
  if (filter.matched) builder = builder.eq('matched_status', filter.matched);
  if (query.keyword) {
    const kw = escapeOrKeyword(query.keyword);
    if (kw) builder = builder.or(`summary.ilike.*${kw}*,matched_ref_no.ilike.*${kw}*`);
  }
  const from = (query.page - 1) * query.pageSize;
  const { data, error, count } = await builder.range(from, from + query.pageSize - 1);
  if (error) throwDbError(error, '查询银行对账单');
  return {
    items: (data ?? []).map((r) => mapStmt(r as Record<string, unknown>)),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

/** 手工录入对账单 */
export async function createBankStatement(input: StmtCreateInput, user: SysUser): Promise<BankStatementView> {
  const parsed = stmtCreateSchema.parse(input);
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from(STMT_TABLE)
    .insert({
      bank_account: emptyToNull(parsed.bank_account ?? null) ?? DEFAULT_BANK_ACCOUNT,
      tran_date: parsed.tran_date,
      direction: parsed.direction,
      amount: Math.round(parsed.amount * 100) / 100,
      summary: emptyToNull(parsed.summary ?? null),
      balance: parsed.balance === undefined || parsed.balance === null ? null : parsed.balance,
      remark: emptyToNull(parsed.remark ?? null),
      source: 'manual',
      created_by: user.id,
    })
    .select('*')
    .single();
  if (error) throwDbError(error, '录入银行对账单');
  return mapStmt(data as Record<string, unknown>);
}

/** 批量导入对账单（数组） */
export async function importBankStatements(rows: StmtCreateInput[], user: SysUser): Promise<{ imported: number }> {
  if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'FIN.EMPTY_IMPORT', '导入数据为空');
  const supabase = getSupabaseClient();
  const payload = rows.map((r) => {
    const p = stmtCreateSchema.parse(r);
    return {
      bank_account: emptyToNull(p.bank_account ?? null) ?? DEFAULT_BANK_ACCOUNT,
      tran_date: p.tran_date,
      direction: p.direction,
      amount: Math.round(p.amount * 100) / 100,
      summary: emptyToNull(p.summary ?? null),
      balance: p.balance === undefined || p.balance === null ? null : p.balance,
      remark: emptyToNull(p.remark ?? null),
      source: 'import',
      created_by: user.id,
    };
  });
  const { error } = await supabase.from(STMT_TABLE).insert(payload);
  if (error) throwDbError(error, '导入银行对账单');
  return { imported: payload.length };
}

/** 删除对账单 */
export async function deleteBankStatement(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase.from(STMT_TABLE).delete().eq('id', id);
  if (error) throwDbError(error, '删除对账单');
}

/** 日记账：由已核销 fin_payments 归集（receipt=in, payment=out） */
async function loadJournal(account: string): Promise<JournalLineView[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('fin_payments')
    .select('id, doc_no, direction, amount, paid_at, method, status')
    .eq('status', 'approved')
    .order('paid_at', { ascending: true });
  if (error) throwDbError(error, '查询银行日记账');
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      account,
      date: String(row.paid_at ?? '').slice(0, 10),
      direction: row.direction === 'receipt' ? 'in' : 'out',
      amount: Number(row.amount ?? 0),
      summary: null,
      ref_no: (row.doc_no as string | null) ?? null,
      doc_no: row.doc_no as string,
      method: (row.method as string | null) ?? null,
      matched: false,
    } as JournalLineView;
  });
}

/**
 * 自动匹配：把未匹配对账单与日记账一对一匹配（同账户+同方向+金额+日期临近）。
 * 匹配成功 → 对账单置 matched 并回写 ref_id/ref_no。
 */
export async function autoMatch(account: string): Promise<MatchResult & { journal: JournalLineView[] }> {
  const supabase = getSupabaseClient();
  const journals = await loadJournal(account);

  // 已匹配的对账单所引用的日记账 id 视为已占用
  const { data: matchedRows, error: mErr } = await supabase
    .from(STMT_TABLE)
    .select('matched_ref_id')
    .eq('matched_status', 'matched')
    .not('matched_ref_id', 'is', null);
  if (mErr) throwDbError(mErr, '查询已匹配对账单');
  const usedJournalIds = new Set((matchedRows ?? []).map((r) => (r as { matched_ref_id: string }).matched_ref_id));

  const { data: stmtRows, error: sErr } = await supabase
    .from(STMT_TABLE)
    .select('*')
    .eq('bank_account', account)
    .eq('matched_status', 'unmatched')
    .order('tran_date', { ascending: true });
  if (sErr) throwDbError(sErr, '查询未匹配对账单');

  const statements: ReconLine[] = (stmtRows ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      account: row.bank_account as string,
      date: String(row.tran_date ?? '').slice(0, 10),
      direction: row.direction as 'in' | 'out',
      amount: Number(row.amount ?? 0),
      summary: (row.summary as string | null) ?? null,
      ref_no: (row.matched_ref_no as string | null) ?? null,
    };
  });

  const availableJournals = journals.filter((j) => !usedJournalIds.has(j.id));
  const result = matchStatements(statements, availableJournals);

  for (const pair of result.matches) {
    const j = availableJournals.find((x) => x.id === pair.journalId);
    const { error } = await supabase
      .from(STMT_TABLE)
      .update({
        matched_status: 'matched',
        matched_ref_type: 'journal',
        matched_ref_id: pair.journalId,
        matched_ref_no: j?.ref_no ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', pair.statementId)
      .eq('matched_status', 'unmatched');
    if (error) throwDbError(error, '回写对账匹配');
  }

  const journalAfter = journals.map((j) => ({ ...j, matched: usedJournalIds.has(j.id) || result.matches.some((m) => m.journalId === j.id) }));
  return { ...result, journal: journalAfter };
}

/** 取消某对账单的匹配 */
export async function unmatchStatement(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from(STMT_TABLE)
    .update({ matched_status: 'unmatched', matched_ref_type: null, matched_ref_id: null, matched_ref_no: null, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throwDbError(error, '取消对账匹配');
}

export interface BankReconView {
  account: string;
  journal: JournalLineView[];
  statements: BankStatementView[];
  reconciliation: ReconciliationView;
}

/** 对账总览：日记账 + 对账单 + 未达账项调节表 */
export async function getReconciliation(account: string = DEFAULT_BANK_ACCOUNT): Promise<BankReconView> {
  const supabase = getSupabaseClient();
  const journals = await loadJournal(account);
  const { data: stmtRows, error } = await supabase
    .from(STMT_TABLE)
    .select('*')
    .eq('bank_account', account)
    .order('tran_date', { ascending: true });
  if (error) throwDbError(error, '查询对账单');
  const statements = (stmtRows ?? []).map((r) => mapStmt(r as Record<string, unknown>));

  const matchedJournalIds = new Set(statements.filter((s) => s.matched_ref_id).map((s) => s.matched_ref_id as string));
  const journalWithMatch = journals.map((j) => ({ ...j, matched: matchedJournalIds.has(j.id) }));

  const unmatchedJournals: ReconLine[] = journalWithMatch.filter((j) => !j.matched);
  const unmatchedStatements: ReconLine[] = statements
    .filter((s) => s.matched_status === 'unmatched')
    .map((s) => ({ id: s.id, account: s.bank_account, date: s.tran_date, direction: s.direction, amount: s.amount, summary: s.summary, ref_no: s.matched_ref_no }));

  const bookBalance = netBalance(journalWithMatch);
  const bankBalance = netBalance(
    statements.map((s) => ({ id: s.id, account: s.bank_account, date: s.tran_date, direction: s.direction, amount: s.amount })),
  );

  const reconciliation = reconcile(bookBalance, bankBalance, unmatchedJournals, unmatchedStatements);
  return { account, journal: journalWithMatch, statements, reconciliation };
}
