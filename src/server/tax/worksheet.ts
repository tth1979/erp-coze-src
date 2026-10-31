/**
 * 申报底稿（worksheet）
 * 汇总某申报期间的销项/进项/应纳税额/预缴抵减/应补(退)税额，逐项列示来源：
 *   - 销项/进项：tax_entries（随业务事件自动落库）
 *   - 发票台账：tax_invoices（人工登记/勾选）
 *   - 异地预缴：tax_prepaid（抵减应纳税额）
 *   - 税会差异：tax_soc_diff（提示）
 */
import { getTaxFiling, round2 } from './tax';
import { computeWorksheet } from './tax-math';
import { invoiceSummary } from './invoices';
import { prepaidTotalByPeriod } from './prepaid';
import { socDiffSummary } from './soc-diff';

export interface WorksheetSource {
  key: string;
  label: string;
  amount: number;
}

export interface WorksheetView {
  period: string;
  // 税额口径
  output_tax: number;
  input_tax: number;
  deductible_input: number;
  vat_before_prepaid: number;
  carried_forward: number;
  // 预缴抵减
  prepaid_total: number;
  net_payable: number;
  refundable: number;
  // 发票台账
  invoice_input_count: number;
  invoice_output_count: number;
  invoice_input_tax: number;
  invoice_output_tax: number;
  // 税会差异
  soc_diff: {
    temporary_count: number;
    temporary_amount: number;
    permanent_count: number;
    permanent_amount: number;
  };
  // 来源明细
  sources: WorksheetSource[];
}

export async function getWorksheet(period: string): Promise<WorksheetView> {
  const filing = await getTaxFiling(period);
  const [inv, prepaid, socDiff] = await Promise.all([
    invoiceSummary(period),
    prepaidTotalByPeriod(period),
    socDiffSummary(period),
  ]);

  const result = computeWorksheet({
    output_tax: filing.output_tax,
    deductible_input: filing.deductible_input,
    prepaid_total: prepaid,
  });

  const sources: WorksheetSource[] = [
    { key: 'output_tax', label: '销项税额（tax_entries）', amount: filing.output_tax },
    { key: 'input_tax', label: '进项税额（tax_entries）', amount: filing.input_tax },
    { key: 'invoice_input', label: '发票台账进项税额', amount: inv.input_tax },
    { key: 'invoice_output', label: '发票台账销项税额', amount: inv.output_tax },
    { key: 'prepaid', label: '异地预缴税额', amount: prepaid },
  ];

  return {
    period,
    output_tax: round2(filing.output_tax),
    input_tax: round2(filing.input_tax),
    deductible_input: round2(filing.deductible_input),
    vat_before_prepaid: result.vat_before_prepaid,
    carried_forward: result.carried_forward,
    prepaid_total: result.prepaid_total,
    net_payable: result.net_payable,
    refundable: result.refundable,
    invoice_input_count: inv.input_count,
    invoice_output_count: inv.output_count,
    invoice_input_tax: inv.input_tax,
    invoice_output_tax: inv.output_tax,
    soc_diff: socDiff,
    sources,
  };
}
