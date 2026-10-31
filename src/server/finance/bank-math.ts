/**
 * 银行对账纯函数（golden 可测）：日记账/对账单匹配 + 未达账项调节表计算。
 *
 * 口径：
 * - 日记账（book）来自系统收付款/报销付款，按银行账户归集。
 * - 对账单（bank）来自导入/手工录入的银行流水。
 * - 匹配：同账户 + 同方向 + 金额相等(±容差) + 日期临近(±天数)，一对一，优先日期最近。
 * - 未达账项：book 未匹配（企业已记银行未记）、bank 未匹配（银行已记企业未记）。
 * - 调节后余额：
 *     账面调节 = 账面余额 + 银行已记未记(未匹配对账单净额)
 *     银行调节 = 银行余额 + 企业已记未记(未匹配日记账净额)
 *   两者应相等（diff≈0 即对账平）。
 */

export interface ReconLine {
  id: string;
  account: string;
  date: string;            // YYYY-MM-DD
  direction: 'in' | 'out';
  amount: number;          // 正数
  summary?: string | null;
  ref_no?: string | null;  // 单号（日记账）/ 对账单号
}

export interface MatchPair {
  statementId: string;
  journalId: string;
}

export interface MatchResult {
  matches: MatchPair[];
  unmatchedStatementIds: string[];
  unmatchedJournalIds: string[];
}

function dayDiff(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00Z').getTime();
  const db = new Date(b + 'T00:00:00Z').getTime();
  return Math.abs(Math.round((da - db) / 86400000));
}

/**
 * 自动匹配：未匹配的对账单 vs 未匹配的日记账，一对一贪心。
 * @param tolerance 金额容差（默认 0.01）
 * @param dayWindow 日期窗口天数（默认 3）
 */
export function matchStatements(
  statements: ReconLine[],
  journals: ReconLine[],
  tolerance = 0.01,
  dayWindow = 3,
): MatchResult {
  const usedJournal = new Set<string>();
  const matches: MatchPair[] = [];
  const unmatchedStatementIds: string[] = [];

  // 对账单按日期升序，稳定匹配
  const stmts = [...statements].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const s of stmts) {
    let best: { j: ReconLine; score: number } | null = null;
    for (const j of journals) {
      if (usedJournal.has(j.id)) continue;
      if (j.account !== s.account) continue;
      if (j.direction !== s.direction) continue;
      if (Math.abs(j.amount - s.amount) > tolerance) continue;
      const dd = dayDiff(j.date, s.date);
      if (dd > dayWindow) continue;
      if (!best || dd < best.score) best = { j, score: dd };
    }
    if (best) {
      usedJournal.add(best.j.id);
      matches.push({ statementId: s.id, journalId: best.j.id });
    } else {
      unmatchedStatementIds.push(s.id);
    }
  }

  const unmatchedJournalIds = journals.filter((j) => !usedJournal.has(j.id)).map((j) => j.id);
  return { matches, unmatchedStatementIds, unmatchedJournalIds };
}

export interface ReconciliationView {
  book_balance: number;          // 账面余额（日记账净额）
  bank_balance: number;          // 银行对账单余额（对账单净额）
  book_unmatched_in: number;     // 企业已记银行未记 - 收入
  book_unmatched_out: number;    // 企业已记银行未记 - 支出
  bank_unmatched_in: number;     // 银行已记企业未记 - 收入
  bank_unmatched_out: number;    // 银行已记企业未记 - 支出
  adjusted_book: number;         // 账面调节后
  adjusted_bank: number;         // 银行调节后
  diff: number;                  // adjusted_book - adjusted_bank
  balanced: boolean;
}

/** 未达账项调节表：入参为未匹配的日记账/对账单行 + 各自全量净余额。 */
export function reconcile(
  bookBalance: number,
  bankBalance: number,
  unmatchedJournals: ReconLine[],
  unmatchedStatements: ReconLine[],
): ReconciliationView {
  const sum = (rows: ReconLine[], dir: 'in' | 'out') =>
    round2(rows.filter((r) => r.direction === dir).reduce((a, r) => a + r.amount, 0));
  const bookUnmatchedIn = sum(unmatchedJournals, 'in');
  const bookUnmatchedOut = sum(unmatchedJournals, 'out');
  const bankUnmatchedIn = sum(unmatchedStatements, 'in');
  const bankUnmatchedOut = sum(unmatchedStatements, 'out');

  const adjustedBook = round2(bookBalance + bankUnmatchedIn - bankUnmatchedOut);
  const adjustedBank = round2(bankBalance + bookUnmatchedIn - bookUnmatchedOut);
  const diff = round2(adjustedBook - adjustedBank);

  return {
    book_balance: round2(bookBalance),
    bank_balance: round2(bankBalance),
    book_unmatched_in: bookUnmatchedIn,
    book_unmatched_out: bookUnmatchedOut,
    bank_unmatched_in: bankUnmatchedIn,
    bank_unmatched_out: bankUnmatchedOut,
    adjusted_book: adjustedBook,
    adjusted_bank: adjustedBank,
    diff,
    balanced: Math.abs(diff) < 0.01,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** 余额按方向净额（in - out） */
export function netBalance(rows: ReconLine[]): number {
  return round2(rows.reduce((a, r) => a + (r.direction === 'in' ? r.amount : -r.amount), 0));
}
