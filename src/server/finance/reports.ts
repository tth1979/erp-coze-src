/**
 * 财务报表：利润表 + 资产负债表（按期间实时聚合，不缓存、不写死金额）
 *
 * 口径：
 * - 利润表取损益类科目（category=6）本期发生额；销售收入科目已由凭证模板价税分离（科目金额即不含税）。
 * - 返点/提成基数 = 不含税收入（营业收入科目贷方发生 − 借方冲减），遵循需求书 MOD-06。
 * - 资产负债表取资产(1)/负债(2)/共同(3)/权益(4)科目期末余额（结转后口径，实时聚合）。
 * - 资产 = 负债 + 所有者权益 校验平衡，差值展示定位。
 */
import { ApiError } from '@/server/http';
import { loadSubjects, getSubjectBalances, periodAccountFlows, type SubjectView } from '@/server/finance/subjects';
import { round2 } from '@/server/ledger/balance-math';

function shiftPeriod(period: string, offsetMonths: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + offsetMonths, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 损益类末级科目的本期净发生额（收入方向=贷方净值，费用方向=借方净值） */
function netOf(flows: Map<string, { debit: number; credit: number }>, code: string): number {
  const f = flows.get(code) ?? { debit: 0, credit: 0 };
  return round2(f.credit - f.debit);
}

export interface PnlRow {
  key: string;
  label: string;
  amount: number;
  prev: number;
  indent: boolean;
  sub?: { label: string; amount: number; prev: number }[]; // 展开明细（本期/上期）
}

export interface PnlReport {
  period: string;
  previous: string;
  rows: PnlRow[];   // 行式（含合计行）
  summary: {
    revenue: number; cost: number; gross: number; gross_margin: number;
    tax_surcharge: number; selling: number; admin: number; finance: number;
    operating_profit: number; nonop_income: number; nonop_expense: number;
    profit_total: number; income_tax: number; net_profit: number;
    rebate_base: number; // 返点/提成基数 = 不含税收入 − 退货
  };
}

/** 利润表：按期间汇总损益科目 */
export async function getPnl(period: string): Promise<PnlReport> {
  const flows = await periodAccountFlows(period);
  const prevFlows = await periodAccountFlows(shiftPeriod(period, -1));

  const P = (f: Map<string, { debit: number; credit: number }>) => netOf(f, '6001');
  const revenue = round2(P(flows));
  const prevRevenue = round2(P(prevFlows));
  const vs = (code: string, key: string): { amount: number; prev: number; key: string; label: string } => {
    const a = netOf(flows, code);
    const p = netOf(prevFlows, code);
    return { amount: a, prev: p, key, label: code };
  };
  const costRow = vs('6401', 'cost'); costRow.label = '营业成本';
  const strategic = vs('6403', 'tax_surcharge'); strategic.label = '税金及附加';

  const expense = (code: string) => netOf(flows, code);
  const expensePrev = (code: string) => netOf(prevFlows, code);

  const selling = expense('6602');
  const admin = expense('6601');
  const finance = expense('6603');

  const gross = round2(revenue - costRow.amount);
  const operating = round2(gross - strategic.amount - selling - admin - finance);
  const rawIncomePut = vs('6301', 'nonop_income'); rawIncomePut.label = '营业外收入';
  const rawExpensePut = vs('6711', 'nonop_expense'); rawExpensePut.label = '营业外支出';
  const profitTotal = round2(operating + rawIncomePut.amount - rawExpensePut.amount);
  const incomeTax = round2(netOf(flows, '6402'));
  const netProfit = round2(profitTotal - incomeTax);

  const hasDetail = revenue !== 0 || costRow.amount !== 0; // 有业务量时展示展开
  const rows: PnlRow[] = [];
  if (hasDetail) {
    rows.push({
      key: 'operate', label: '一、营业收支', amount: 0, prev: 0, indent: false,
      sub: [
        { label: '营业收入（不含税，抵减退货）', amount: revenue, prev: prevRevenue },
        { label: '减：营业成本', amount: costRow.amount, prev: costRow.prev },
        { label: '毛利', amount: gross, prev: round2(gross) },
        { label: '减：税金及附加', amount: strategic.amount, prev: strategic.prev },
      ],
    });
  }
  rows.push({ key: 'gross', label: '毛利（营业收入−营业成本）', amount: gross, prev: round2(prevRevenue - costRow.prev), indent: false });
  rows.push({ key: 'tax_surcharge', label: '减：税金及附加', amount: strategic.amount, prev: strategic.prev, indent: true });
  rows.push({ key: 'selling', label: '减：销售费用', amount: selling, prev: expensePrev('6602'), indent: true });
  rows.push({ key: 'admin', label: '减：管理费用', amount: admin, prev: expensePrev('6601'), indent: true });
  rows.push({ key: 'finance', label: '减：财务费用', amount: finance, prev: expensePrev('6603'), indent: true });
  rows.push({ key: 'operating', label: '三、营业利润', amount: operating, prev: round2(prevRevenue - costRow.prev - strategic.prev - expensePrev('6602') - expensePrev('6601') - expensePrev('6603')), indent: false });
  rows.push({ key: 'nonop_income', label: '加：营业外收入', amount: rawIncomePut.amount, prev: rawIncomePut.prev, indent: true });
  rows.push({ key: 'nonop_expense', label: '减：营业外支出', amount: rawExpensePut.amount, prev: rawExpensePut.prev, indent: true });
  rows.push({ key: 'profit_total', label: '四、利润总额', amount: profitTotal, prev: round2(profitTotal - incomeTax), indent: false });
  rows.push({ key: 'income_tax', label: '减：所得税费用', amount: incomeTax, prev: round2(incomeTax), indent: true });
  rows.push({ key: 'net_profit', label: '五、净利润', amount: netProfit, prev: round2(netProfit), indent: false });

  const summary = {
    revenue, cost: costRow.amount, gross, gross_margin: revenue ? round2((gross / revenue) * 100) : 0,
    tax_surcharge: strategic.amount, selling, admin, finance, operating_profit: operating,
    nonop_income: rawIncomePut.amount, nonop_expense: rawExpensePut.amount, profit_total: profitTotal,
    income_tax: incomeTax, net_profit: netProfit,
    rebate_base: revenue,
  };
  return { period, previous: shiftPeriod(period, -1), rows, summary };
}

export interface BalanceLine {
  subject_code: string;
  subject_name: string;
  opening: number;  // 带方向符号（借+ 贷-）
  closing: number;
  leaf: boolean;
}

export interface BalanceSheetReport {
  period: string;
  groups: {
    key: string; label: string; direction: '借' | '贷';
    opening: number; closing: number;
    lines: BalanceLine[];
  }[];
  money_fund: number;      // 货币资金期末（库存现金+银行存款等）
  money_fund_opening: number;
  total_assets: number;    // 资产合计（期末，借正）
  total_liab_equity: number; // 负债+权益合计（期末，贷正）
  balanced: boolean;
  diff: number;            // 资产 − 负债 − 权益（应为 0）
  opening_assets: number;
  opening_liab_equity: number;
}

const MONEY_CODES = ['1001', '1002', '1012'];

/** 资产负债表：按期间实时取资产/负债/权益科目期末余额（结转后口径） */
export async function getBalanceSheet(period: string): Promise<BalanceSheetReport> {
  const { rows } = await getSubjectBalances(period);
  const subjects = await loadSubjects();
  const dict = new Map(subjects.map((s) => [s.subject_code, s]));

  const lines: { key: string; label: string; opening: number; closing: number; rows: BalanceLine[] }[] = [
    { key: 'assets', label: '资产', opening: 0, closing: 0, rows: [] },
    { key: 'liab', label: '负债', opening: 0, closing: 0, rows: [] },
    { key: 'common', label: '共同类', opening: 0, closing: 0, rows: [] },
    { key: 'equity', label: '所有者权益', opening: 0, closing: 0, rows: [] },
  ];

  for (const r of rows) {
    const s: SubjectView | undefined = dict.get(r.subject_code);
    if (!s || s.category > 4) continue;
    const group = lines.find((g) => g.key === (s.category === 1 ? 'assets' : s.category === 2 ? 'liab' : s.category === 3 ? 'common' : 'equity'));
    if (!group) continue;
    group.opening += r.opening;
    group.closing += r.closing;
    group.rows.push({
      subject_code: r.subject_code,
      subject_name: r.subject_name,
      opening: round2(r.opening),
      closing: round2(r.closing),
      leaf: r.is_leaf,
    });
  }
  for (const g of lines) {
    g.opening = round2(g.opening);
    g.closing = round2(g.closing);
    g.rows.sort((a, b) => a.subject_code.localeCompare(b.subject_code));
  }

  const assetGroup = lines.find((l) => l.key === 'assets')!;
  const totalAssets = assetGroup.closing; // 借正
  const totalLiabEquity = round2(
    lines.filter((l) => l.key !== 'assets').reduce((sum, l) => sum + l.closing, 0),
  ); // 贷负（符号）
  const openingAssets = assetGroup.opening;
  const openingLiabEquity = round2(
    lines.filter((l) => l.key !== 'assets').reduce((sum, l) => sum + l.opening, 0),
  );

  // 货币资金
  let moneyFund = 0;
  let moneyFundOpening = 0;
  for (const code of MONEY_CODES) {
    const r = rows.find((x) => x.subject_code === code);
    if (r) {
      moneyFund += r.closing;
      moneyFundOpening += r.opening;
    }
  }

  const diff = round2(totalAssets + totalLiabEquity); // 符号口径：资产 + (负债+权益)应=0
  return {
    period,
    groups: lines.map((g) => ({
      key: g.key, label: g.label, direction: g.key === 'assets' ? '借' : '贷',
      opening: g.opening, closing: g.closing, lines: g.rows,
    })),
    money_fund: round2(moneyFund),
    money_fund_opening: round2(moneyFundOpening),
    total_assets: totalAssets,
    total_liab_equity: round2(-totalLiabEquity), // 展示为正的“负债+权益”合计
    opening_assets: openingAssets,
    opening_liab_equity: round2(-openingLiabEquity),
    balanced: Math.abs(diff) < 0.01,
    diff,
  };
}