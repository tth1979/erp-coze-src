/**
 * 税务增强纯函数（无副作用，供 golden 测试与业务复用）
 * - 发票价税合计
 * - 税会差异额
 * - 申报底稿口径（预缴抵减 → 应补/应退）
 */

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface InvoiceAmounts {
  amount_ex_tax: number;
  tax_amount: number;
}

/** 价税合计 = 不含税 + 税额 */
export function invoiceTotal(a: InvoiceAmounts): number {
  return round2(Number(a.amount_ex_tax) + Number(a.tax_amount));
}

/** 由不含税额与税率算税额：tax = round2(excl * rate / 100) */
export function taxFromExcl(excl: number, rate: number): number {
  return round2((Number(excl) * Number(rate)) / 100);
}

export interface SocDiffInput {
  tax_base: number;
  accounting_base: number;
}

/** 税会差异额 = 税法金额 − 会计金额（正=税法多计，负=会计多计） */
export function socDiffAmount(input: SocDiffInput): number {
  return round2(Number(input.tax_base) - Number(input.accounting_base));
}

export interface WorksheetInput {
  output_tax: number;
  deductible_input: number;
  prepaid_total: number;
}

export interface WorksheetResult {
  output_tax: number;
  deductible_input: number;
  /** 抵减预缴前的应纳增值税 = max(销项 − 可抵扣进项, 0) */
  vat_before_prepaid: number;
  /** 期末留抵 = max(可抵扣进项 − 销项, 0) */
  carried_forward: number;
  /** 已预缴税额合计 */
  prepaid_total: number;
  /** 应补(退)税额 = 应纳 − 预缴（>0 应补，<0 应退）；留抵时不为负 */
  net_payable: number;
  /** 应退税额 = max(预缴 − 应纳, 0) */
  refundable: number;
}

/**
 * 申报底稿口径：
 *   应纳增值税 = max(销项 − 可抵扣进项, 0)（不足则为留抵，不产生退税）
 *   应补(退)税额 = 应纳增值税 − 已预缴（>0 应补，<0 应退）
 */
export function computeWorksheet(input: WorksheetInput): WorksheetResult {
  const output = round2(Number(input.output_tax));
  const deductible = round2(Number(input.deductible_input));
  const prepaid = round2(Number(input.prepaid_total));
  const diff = round2(output - deductible);
  const vatBeforePrepaid = Math.max(diff, 0);
  const carriedForward = Math.max(-diff, 0);
  const net = round2(vatBeforePrepaid - prepaid);
  return {
    output_tax: output,
    deductible_input: deductible,
    vat_before_prepaid: vatBeforePrepaid,
    carried_forward: carriedForward,
    prepaid_total: prepaid,
    net_payable: Math.max(net, 0),
    refundable: Math.max(-net, 0),
  };
}
