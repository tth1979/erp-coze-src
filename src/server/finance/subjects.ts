/**
 * 会计科目字典 + 科目余额表 + 试算平衡表（fin_subjects）
 *
 * - 科目字典即唯一账务来源：凭证分录 account_code 与余额表均以 fin_subjects 为准。
 * - 层级：非末级（is_leaf=false）科目不可直接用于凭证分录（服务端强制校验）。
 * - 期初余额：按科目配置开账余额（opening_amount + opening_direction）。
 * - 余额表/试算平衡：仅统计 status='posted' 且 status<>'void' 的凭证分录，按期间实时聚合。
 */
import { z } from 'zod';
import { ApiError } from '@/server/http';
import { emptyToNull, escapeOrKeyword, throwDbError, type ListQuery, type PagedResult } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { computeClosing, round2 } from '@/server/ledger/balance-math';
import { ensureLeafCodes } from '@/server/finance/leaf-guard';

export { ensureLeafCodes };

export const SUBJECT_CATEGORIES = [
  { value: 1, label: '资产' },
  { value: 2, label: '负债' },
  { value: 3, label: '共同' },
  { value: 4, label: '权益' },
  { value: 5, label: '成本' },
  { value: 6, label: '损益' },
] as const;

export interface SubjectView {
  id: string;
  subject_code: string;
  subject_name: string;
  category: number;
  parent_code: string | null;
  direction: number;         // 0借 1贷
  is_leaf: boolean;
  balance_flag: boolean;
  opening_amount: number;
  opening_direction: number;
  status: string;
  sort_no: number;
  remark: string | null;
  created_at: string;
}

export interface SubjectInput {
  subject_code?: string;
  subject_name?: string;
  category?: number;
  parent_code?: string | null;
  direction?: number;
  is_leaf?: boolean;
  balance_flag?: boolean;
  opening_amount?: number;
  opening_direction?: number;
  status?: 'active' | 'disabled';
  sort_no?: number;
  remark?: string | null;
}

const subjectCreateSchema = z.object({
  subject_code: z.string().trim().min(1, '科目编码不能为空').max(32).regex(/^[0-9A-Za-z._-]+$/, '科目编码仅允许字母/数字/./_/-'),
  subject_name: z.string().trim().min(1, '科目名称不能为空').max(128),
  category: z.coerce.number().int().min(1).max(6),
  parent_code: z.string().trim().max(32).nullish(),
  direction: z.coerce.number().int().min(0).max(1).default(0),
  balance_flag: z.boolean().optional(),
  opening_amount: z.coerce.number().min(0).optional(),
  opening_direction: z.coerce.number().int().min(0).max(1).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  sort_no: z.coerce.number().int().min(0).optional(),
  remark: z.string().max(1000).nullish(),
});

const subjectUpdateSchema = subjectCreateSchema.partial().omit({ subject_code: true });

function mapSubject(r: Record<string, unknown>): SubjectView {
  return {
    id: r.id as string,
    subject_code: r.subject_code as string,
    subject_name: r.subject_name as string,
    category: Number(r.category),
    parent_code: (r.parent_code as string | null) ?? null,
    direction: Number(r.direction ?? 0),
    is_leaf: Boolean(r.is_leaf),
    balance_flag: Boolean(r.balance_flag),
    opening_amount: Number(r.opening_amount ?? 0),
    opening_direction: Number(r.opening_direction ?? 0),
    status: (r.status as string) ?? 'active',
    sort_no: Number(r.sort_no ?? 0),
    remark: (r.remark as string | null) ?? null,
    created_at: r.created_at as string,
  };
}

async function findSubjectByCode(code: string): Promise<Record<string, unknown> | null> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fin_subjects').select('*').eq('subject_code', code).maybeSingle();
  if (error) throwDbError(error, '查询科目');
  return (data as Record<string, unknown> | null) ?? null;
}

export interface SubjectListQuery extends ListQuery {
  category?: number;
  status?: string;
}

/** 科目分页（关键字 = 编码/名称；可按类别/状态过滤） */
export async function listSubjects(query: SubjectListQuery): Promise<PagedResult<SubjectView>> {
  const supabase = getSupabaseClient();
  let req = supabase.from('fin_subjects').select('*', { count: 'exact' });
  if (query.category) req = req.eq('category', query.category);
  if (query.status) req = req.eq('status', query.status);
  const kw = escapeOrKeyword(query.keyword);
  if (kw) req = req.or(`subject_code.ilike.%${kw}%,subject_name.ilike.%${kw}%`);
  const { data, error, count } = await req
    .order('category', { ascending: true })
    .order('sort_no', { ascending: true })
    .order('subject_code', { ascending: true })
    .range((query.page - 1) * query.pageSize, query.page * query.pageSize - 1);
  if (error) throwDbError(error, '查询科目');
  return {
    items: (data ?? []).map((r) => mapSubject(r as Record<string, unknown>)),
    total: count ?? 0,
    page: query.page,
    page_size: query.pageSize,
  };
}

export async function getSubject(id: string): Promise<SubjectView> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fin_subjects').select('*').eq('id', id).maybeSingle();
  if (error) throwDbError(error, '查询科目');
  if (!data) throw new ApiError(404, 'FIN.SUBJECT_NOT_FOUND', '科目不存在');
  return mapSubject(data as Record<string, unknown>);
}

// ensureLeafCodes 见 src/server/finance/leaf-guard.ts（此处 re-export）

export async function createSubject(input: SubjectInput): Promise<SubjectView> {
  const parsed = subjectCreateSchema.parse(input);
  const code = parsed.subject_code!;
  if (parsed.parent_code) {
    const parent = await findSubjectByCode(parsed.parent_code);
    if (!parent) throw new ApiError(400, 'FIN.PARENT_NOT_FOUND', `上级科目 ${parsed.parent_code} 不存在`);
    // 有子级后上级不再是末级
    const { error: updErr } = await getSupabaseClient()
      .from('fin_subjects')
      .update({ is_leaf: false, updated_at: new Date().toISOString() })
      .eq('subject_code', parsed.parent_code);
    if (updErr) throwDbError(updErr, '更新上级科目');
  }
  const row = {
    subject_code: code,
    subject_name: parsed.subject_name!,
    category: parsed.category!,
    parent_code: emptyToNull(parsed.parent_code),
    direction: parsed.direction ?? 0,
    is_leaf: true,
    balance_flag: parsed.balance_flag ?? true,
    opening_amount: parsed.opening_amount ?? 0,
    opening_direction: parsed.opening_direction ?? parsed.direction ?? 0,
    status: parsed.status ?? 'active',
    sort_no: parsed.sort_no ?? 0,
    remark: emptyToNull(parsed.remark),
  };
  const { data, error } = await getSupabaseClient().from('fin_subjects').insert(row).select().single();
  if (error) throwDbError(error, '新增科目');
  return mapSubject(data as Record<string, unknown>);
}

export async function updateSubject(id: string, input: SubjectInput): Promise<SubjectView> {
  const parsed = subjectUpdateSchema.parse(input);
  const existing = await getSubject(id);
  const supabase = getSupabaseClient();
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (parsed.parent_code !== undefined) {
    const pc = emptyToNull(parsed.parent_code);
    if (pc && pc === existing.subject_code) throw new ApiError(400, 'FIN.CYCLE', '上级科目不能是自身');
    // 检查是否构成环：新的 parent 不能是该科目自身的后代
    if (pc) {
      const descendants = new Set<string>();
      let frontier = [existing.subject_code];
      while (frontier.length) {
        const { data, error } = await supabase.from('fin_subjects').select('subject_code').in('parent_code', frontier);
        if (error) throwDbError(error, '校验科目层级');
        const next = (data ?? []).map((r) => (r as Record<string, unknown>).subject_code as string);
        next.forEach((c) => descendants.add(c));
        frontier = next;
      }
      if (descendants.has(pc)) throw new ApiError(400, 'FIN.CYCLE', '上级科目不可设为自身后代');
      patch.parent_code = pc;
      // 挂父级：父级不再末级
      await supabase.from('fin_subjects').update({ is_leaf: false, updated_at: new Date().toISOString() }).eq('subject_code', pc);
    } else {
      patch.parent_code = null;
    }
  }
  if (parsed.subject_name !== undefined) patch.subject_name = parsed.subject_name;
  if (parsed.category !== undefined) patch.category = parsed.category;
  if (parsed.direction !== undefined) patch.direction = parsed.direction;
  if (parsed.balance_flag !== undefined) patch.balance_flag = parsed.balance_flag;
  if (parsed.opening_amount !== undefined) patch.opening_amount = parsed.opening_amount;
  if (parsed.opening_direction !== undefined) patch.opening_direction = parsed.opening_direction;
  if (parsed.status !== undefined) patch.status = parsed.status;
  if (parsed.sort_no !== undefined) patch.sort_no = parsed.sort_no;
  if (parsed.remark !== undefined) patch.remark = emptyToNull(parsed.remark);

  const { data, error } = await supabase.from('fin_subjects').update(patch).eq('id', id).select().single();
  if (error) throwDbError(error, '更新科目');
  return mapSubject(data as Record<string, unknown>);
}

export async function removeSubject(id: string): Promise<void> {
  const subj = await getSubject(id);
  const supabase = getSupabaseClient();
  const code = subj.subject_code;
  // 1) 有凭证分录引用 → 不可删
  const { data: refs, error: refErr } = await supabase.from('fin_voucher_lines').select('voucher_id').eq('account_code', code).limit(1);
  if (refErr) throwDbError(refErr, '校验科目引用');
  if ((refs ?? []).length) throw new ApiError(400, 'FIN.SUBJECT_REFERENCED', '该科目已被凭证分录引用，不可删除，可停用');
  // 2) 有子级 → 不可删
  const { data: children, error: childErr } = await supabase.from('fin_subjects').select('id').eq('parent_code', code).limit(1);
  if (childErr) throwDbError(childErr, '校验科目子级');
  if ((children ?? []).length) throw new ApiError(400, 'FIN.SUBJECT_HAS_CHILDREN', '该科目存在下级科目，不可删除');
  // 3) 已有期初余额 → 不可删
  if (subj.opening_amount !== 0) throw new ApiError(400, 'FIN.SUBJECT_HAS_BALANCE', '该科目已配置期初余额，不可删除，可停用');
  const { error } = await supabase.from('fin_subjects').delete().eq('id', id);
  if (error) throwDbError(error, '删除科目');
}

// ---------------------------------------------------------------------------
// 余额表 / 试算平衡（按期间实时聚合，仅统计已过账非作废凭证）
// ---------------------------------------------------------------------------

export interface SubjectBalanceLine {
  subject_code: string;
  subject_name: string;
  category: number;
  parent_code: string | null;
  is_leaf: boolean;
  direction: number;
  balance_flag: boolean;
  status: string;
  opening: number;       // 期初（带方向符号）
  debit: number;         // 本期借方发生
  credit: number;        // 本期贷方发生
  closing: number;       // 期末（带方向符号，正=借 负=贷）
}

interface VoucherAcc {
  debit: number;
  credit: number;
}

function periodRange(period: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new ApiError(400, 'FIN.BAD_PERIOD', '期间格式应为 YYYY-MM');
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, '0')}` };
}

/** 按期间取已过账(非作废)凭证分录的科目发生额 */
export async function periodAccountFlows(period: string): Promise<Map<string, VoucherAcc>> {
  const { from, to } = periodRange(period);
  return accountFlowsBetween(from, to);
}

/** 按任意日期区间取已过账(非作废)凭证分录的科目发生额 */
export async function accountFlowsBetween(from: string, to: string): Promise<Map<string, VoucherAcc>> {
  const supabase = getSupabaseClient();
  const { data: vouchers, error: vErr } = await supabase
    .from('fin_vouchers')
    .select('id')
    .eq('status', 'posted')
    .gte('voucher_date', from)
    .lte('voucher_date', to);
  if (vErr) throwDbError(vErr, '查询凭证');
  const ids = (vouchers ?? []).map((v) => v.id as string);
  const acc = new Map<string, VoucherAcc>();
  if (ids.length === 0) return acc;
  const { data: lines, error: lErr } = await supabase.from('fin_voucher_lines').select('account_code, direction, amount').in('voucher_id', ids);
  if (lErr) throwDbError(lErr, '查询分录');
  for (const l of lines ?? []) {
    const code = l.account_code as string;
    const amt = Number(l.amount ?? 0);
    const row = acc.get(code) ?? { debit: 0, credit: 0 };
    if (l.direction === 'd') row.debit += amt;
    else row.credit += amt;
    acc.set(code, row);
  }
  return acc;
}

export async function loadSubjects(): Promise<SubjectView[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from('fin_subjects').select('*').order('subject_code', { ascending: true });
  if (error) throwDbError(error, '查询科目');
  return (data ?? []).map((r) => mapSubject(r as Record<string, unknown>));
}

/** 科目余额表：按期间实时聚合期初+本期借/贷+期末；父级科目自动汇总子级 */
export async function getSubjectBalances(period: string): Promise<{ period: string; rows: SubjectBalanceLine[] }> {
  const subjects = await loadSubjects();
  const flows = await periodAccountFlows(period);
  const byCode = new Map<string, SubjectView & { debit: number; credit: number }>();
  for (const s of subjects) {
    const f = flows.get(s.subject_code) ?? { debit: 0, credit: 0 };
    byCode.set(s.subject_code, { ...s, debit: f.debit, credit: f.credit });
  }
  const lines = new Map<string, SubjectBalanceLine>();

  const compute = (code: string): SubjectBalanceLine => {
    const cached = lines.get(code);
    if (cached) return cached;
    const s = byCode.get(code);
    if (!s) throw new ApiError(500, 'FIN.SUBJECT_MISSING', `科目 ${code} 不存在`);
    const openingSigned = s.opening_direction === 0 ? s.opening_amount : -s.opening_amount;
    let debit = s.debit;
    let credit = s.credit;
    // 汇总子级
    if (!s.is_leaf) {
      for (const child of byCode.values()) {
        if (child.parent_code === code) {
          const childLine = compute(child.subject_code);
          debit += childLine.debit;
          credit += childLine.credit;
        }
      }
    }
    const closing = computeClosing(openingSigned, debit, credit);
    const line: SubjectBalanceLine = {
      subject_code: s.subject_code,
      subject_name: s.subject_name,
      category: s.category,
      parent_code: s.parent_code,
      is_leaf: s.is_leaf,
      direction: s.direction,
      balance_flag: s.balance_flag,
      status: s.status,
      opening: round2(openingSigned),
      debit: round2(debit),
      credit: round2(credit),
      closing,
    };
    lines.set(code, line);
    return line;
  };

  const all = [...byCode.keys()].map(compute);
  return { period, rows: all };
}

/** 试算平衡表：以实际分录发生额为口径（含红字负数相抵），借贷必等；不平衡展示差额定位 */
export async function getTrialBalance(period: string): Promise<{
  period: string;
  rows: { subject_code: string; subject_name: string; direction: number; debit: number; credit: number; closing: number; is_leaf: boolean }[];
  total_debit: number;
  total_credit: number;
  balanced: boolean;
  diff: number;
}> {
  const flows = await periodAccountFlows(period);
  const subjects = await loadSubjects();
  const dict = new Map(subjects.map((s) => [s.subject_code, s]));
  let totalDebit = 0;
  let totalCredit = 0;
  const rowMap = new Map<string, { subject_code: string; subject_name: string; direction: number; debit: number; credit: number; closing: number; is_leaf: boolean }>();
  for (const [code, f] of flows) {
    totalDebit += f.debit;
    totalCredit += f.credit;
    const s = dict.get(code);
    const openingSigned = s ? (s.opening_direction === 0 ? s.opening_amount : -s.opening_amount) : 0;
    rowMap.set(code, {
      subject_code: code,
      subject_name: s ? s.subject_name : code,
      direction: s ? s.direction : f.debit >= f.credit ? 0 : 1,
      debit: round2(f.debit),
      credit: round2(f.credit),
      closing: round2(s ? computeClosing(openingSigned, f.debit, f.credit) : f.debit - f.credit),
      is_leaf: s ? s.is_leaf : true,
    });
  }
  const rows = [...rowMap.values()].sort((a, b) => a.subject_code.localeCompare(b.subject_code));
  const total_debit = round2(totalDebit);
  const total_credit = round2(totalCredit);
  const diff = round2(total_debit - total_credit);
  return { period, rows, total_debit, total_credit, balanced: Math.abs(diff) < 0.01, diff };
}