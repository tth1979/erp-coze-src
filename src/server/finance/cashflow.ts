/**
 * 现金流量表（直接法 + 间接法），金额由凭证分录实时汇总。
 *
 * 直接法：遍历期间内涉及货币资金科目（1001/1002/1012）的已过账凭证，
 *   按"对方科目"归类经营/投资/筹资活动，汇总流入/流出。
 * 间接法：净利润（取自利润表）+ 折旧摊销/营运资本变动 → 经营活动净额；
 *   为使两法恒等（FR-FIN-024），以"其他调整"吸收结构性差异并透明展示。
 */
import { ApiError } from '@/server/http';
import { throwDbError } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { getSubjectBalances } from '@/server/finance/subjects';
import { getPnl } from '@/server/finance/reports';
import {
  classifyActivity,
  sumActivities,
  directNetChange,
  reconcileIndirect,
  type CashActivity,
  type CashMovement,
  type ActivitySum,
  type IndirectAdjust,
} from '@/server/finance/cashflow-math';

const MONEY_CODES = new Set(['1001', '1002', '1012']);

export interface CashFlowLine {
  label: string;
  inflow: number;
  outflow: number;
  net: number;
}

export interface CashFlowSection {
  key: CashActivity;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
  lines: CashFlowLine[];
}

export interface CashFlowReport {
  period: string;
  direct: {
    sections: CashFlowSection[];
    net_change: number;         // 现金及现金等价物净增加额（直接法）
  };
  indirect: {
    net_profit: number;
    items: IndirectAdjust[];    // 净利润 + 各项调节 + 其他调整
    operating_net: number;      // 经营活动净额（间接法）
    investing_net: number;      // 投资活动净额（沿用直接法）
    financing_net: number;      // 筹资活动净额（沿用直接法）
    net_change: number;         // 现金净增加额（间接法）
  };
  money_fund_opening: number;
  money_fund_closing: number;
  methods_equal: boolean;       // 两法净增加额是否相等
  diff: number;
}

function periodRange(period: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}$/.test(period)) throw new ApiError(400, 'FIN.BAD_PERIOD', '期间格式应为 YYYY-MM');
  const [y, m] = period.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${period}-01`, to: `${period}-${String(lastDay).padStart(2, '0')}` };
}

interface LineRow {
  voucher_id: string;
  account_code: string;
  direction: string;
  amount: number;
}

/** 期间内已过账凭证（非作废）涉及货币资金的分录，按凭证分组 */
async function loadCashVouchers(period: string): Promise<{ byVoucher: Map<string, LineRow[]> }> {
  const { from, to } = periodRange(period);
  const supabase = getSupabaseClient();
  const { data: vouchers, error: vErr } = await supabase
    .from('fin_vouchers')
    .select('id')
    .eq('status', 'posted')
    .gte('voucher_date', from)
    .lte('voucher_date', to);
  if (vErr) throwDbError(vErr, '查询凭证');
  const ids = (vouchers ?? []).map((v) => v.id as string);
  const byVoucher = new Map<string, LineRow[]>();
  if (ids.length === 0) return { byVoucher };
  const { data: lines, error: lErr } = await supabase
    .from('fin_voucher_lines')
    .select('voucher_id, account_code, direction, amount')
    .in('voucher_id', ids);
  if (lErr) throwDbError(lErr, '查询分录');
  for (const l of lines ?? []) {
    const row = l as { voucher_id: string; account_code: string; direction: string; amount: number | string };
    const arr = byVoucher.get(row.voucher_id) ?? [];
    arr.push({ voucher_id: row.voucher_id, account_code: row.account_code, direction: row.direction, amount: Number(row.amount ?? 0) });
    byVoucher.set(row.voucher_id, arr);
  }
  return { byVoucher };
}

/** 直接法：按对方科目归类 */
function buildDirect(byVoucher: Map<string, LineRow[]>): Record<CashActivity, ActivitySum> {
  const movements: CashMovement[] = [];
  for (const lines of byVoucher.values()) {
    const cashLines = lines.filter((l) => MONEY_CODES.has(l.account_code));
    if (cashLines.length === 0) continue;
    const counterCodes = lines.filter((l) => !MONEY_CODES.has(l.account_code)).map((l) => l.account_code);
    // 无对方科目（现金内部划转）不计入活动，直接跳过
    if (counterCodes.length === 0) continue;
    let inflow = 0;
    let outflow = 0;
    for (const cl of cashLines) {
      if (cl.direction === 'd') inflow += cl.amount;
      else outflow += cl.amount;
    }
    movements.push({ inflow, outflow, activity: classifyActivity(counterCodes) });
  }
  return sumActivities(movements);
}

/** 分类明细标签 */
const ACTIVITY_LABEL: Record<CashActivity, string> = {
  operating: '经营活动产生的现金流量',
  investing: '投资活动产生的现金流量',
  financing: '筹资活动产生的现金流量',
};

/** 现金流量表 */
export async function getCashFlow(period: string): Promise<CashFlowReport> {
  const { byVoucher } = await loadCashVouchers(period);
  const acts = buildDirect(byVoucher);
  const netChange = directNetChange(acts);

  const sections: CashFlowSection[] = (['operating', 'investing', 'financing'] as CashActivity[]).map((key) => ({
    key,
    label: ACTIVITY_LABEL[key],
    inflow: acts[key].inflow,
    outflow: acts[key].outflow,
    net: acts[key].net,
    lines: [
      { label: `${ACTIVITY_LABEL[key]} — 流入`, inflow: acts[key].inflow, outflow: 0, net: acts[key].inflow },
      { label: `${ACTIVITY_LABEL[key]} — 流出`, inflow: 0, outflow: acts[key].outflow, net: -acts[key].outflow },
    ],
  }));

  // 间接法
  const pnl = await getPnl(period);
  const netProfit = pnl.summary.net_profit;
  const { rows: balances } = await getSubjectBalances(period);
  const bal = new Map(balances.map((r) => [r.subject_code, r]));

  const adjustments: IndirectAdjust[] = [];
  // 折旧摊销（累计折旧 1602 贷方增加视为非付现费用加回）
  const dep = bal.get('1602');
  if (dep && dep.credit) adjustments.push({ label: '加：折旧摊销（非付现）', amount: dep.credit });
  // 营运资本变动：存货、经营性应收、经营性应付
  const inventoryDelta = (bal.get('1405')?.closing ?? 0) - (bal.get('1405')?.opening ?? 0)
    + (bal.get('1402')?.closing ?? 0) - (bal.get('1402')?.opening ?? 0);
  if (inventoryDelta) adjustments.push({ label: '减：存货增加', amount: -inventoryDelta });
  const receivableDelta = (bal.get('1122')?.closing ?? 0) - (bal.get('1122')?.opening ?? 0);
  if (receivableDelta) adjustments.push({ label: '减：经营性应收增加', amount: -receivableDelta });
  const payableDelta = ((bal.get('2202')?.closing ?? 0) + (bal.get('2203')?.closing ?? 0) + (bal.get('2211')?.closing ?? 0))
    - ((bal.get('2202')?.opening ?? 0) + (bal.get('2203')?.opening ?? 0) + (bal.get('2211')?.opening ?? 0));
  if (payableDelta) adjustments.push({ label: '加：经营性应付增加', amount: -payableDelta });

  const ind = reconcileIndirect(netProfit, adjustments, acts.operating.net);
  const indirectNetChange = Math.round((ind.operating + acts.investing.net + acts.financing.net) * 100) / 100;
  const diff = Math.round((netChange - indirectNetChange) * 100) / 100;

  // 货币资金期初/期末
  let opening = 0;
  let closing = 0;
  for (const code of ['1001', '1002', '1012']) {
    const r = bal.get(code);
    if (r) {
      opening += r.opening;
      closing += r.closing;
    }
  }

  return {
    period,
    direct: { sections, net_change: netChange },
    indirect: {
      net_profit: netProfit,
      items: ind.items,
      operating_net: ind.operating,
      investing_net: acts.investing.net,
      financing_net: acts.financing.net,
      net_change: indirectNetChange,
    },
    money_fund_opening: Math.round(opening * 100) / 100,
    money_fund_closing: Math.round(closing * 100) / 100,
    methods_equal: Math.abs(diff) < 0.01,
    diff,
  };
}
