/**
 * 科目余额/试算平衡纯函数（供 golden set 回归 + 服务端共用）。
 * 约定：余额带方向符号，正=借、负=贷。
 */

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 期末余额 = 期初(带符号) + (本期借方 − 本期贷方) */
export function computeClosing(openingSigned: number, debit: number, credit: number): number {
  return round2(openingSigned + (debit - credit));
}

export interface TrialRowLike {
  debit: number;
  credit: number;
}

export interface TrialTotals {
  total_debit: number;
  total_credit: number;
  diff: number;
  balanced: boolean;
}

/** 汇总一组科目发生额得出借贷合计与平衡判定（含红字负数，符号相抵后借贷必等） */
export function sumTrial(rows: TrialRowLike[]): TrialTotals {
  const total_debit = round2(rows.reduce((a, r) => a + r.debit, 0));
  const total_credit = round2(rows.reduce((a, r) => a + r.credit, 0));
  const diff = round2(total_debit - total_credit);
  return { total_debit, total_credit, diff, balanced: Math.abs(diff) < 0.01 };
}

/** 营业收入 = 贷方净值（价税分离后，抵减退货/红字冲减） */
export function pnlRevenue(credit: number, debit: number): number {
  return round2(credit - debit);
}

/** 营业成本/费用 = 借方净值 */
export function pnlExpense(debit: number, credit: number): number {
  return round2(debit - credit);
}

/** 结转损益净额 = 收入合计 − 费用合计（正=盈利贷本年利润，负=亏损借本年利润） */
export function pnlNet(incomeTotal: number, expenseTotal: number): number {
  return round2(incomeTotal - expenseTotal);
}

/** 资产负债表平衡判定：资产(借正) + 负债+权益(贷负) 应等于 0 */
export function balanceEquality(assetsSigned: number, liabEquitySigned: number): { balanced: boolean; diff: number } {
  const diff = round2(assetsSigned + liabEquitySigned);
  return { balanced: Math.abs(diff) < 0.01, diff };
}

/** 期间是否已结账锁定（open 之外的 closed / annual_closed / locked 均视为锁定） */
export function periodLocked(status: string, locked: boolean): boolean {
  return status === 'closed' || status === 'annual_closed' || locked;
}