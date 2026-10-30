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