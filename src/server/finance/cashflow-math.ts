/**
 * 现金流量表纯函数（golden 可测）：直接法分类 + 间接法净利润调节 + 两法恒等。
 *
 * 直接法：把每张涉及货币资金科目的凭证，按对方科目归类为 经营/投资/筹资 活动，
 *         汇总流入/流出/净额；三类净额之和 = 现金净增加额。
 * 间接法：净利润 + 非付现调整 + 营运资本变动 = 经营活动净额；投资/筹资沿用直接法；
 *         为使两法结果强制相等（FR-FIN-024），以"其他调整"项吸收结构性差异并透明展示。
 */

export type CashActivity = 'operating' | 'investing' | 'financing';

export interface CashMovement {
  inflow: number;    // 货币资金借方（流入）
  outflow: number;   // 货币资金贷方（流出）
  activity: CashActivity;
}

export interface ActivitySum {
  inflow: number;
  outflow: number;
  net: number;
}

export interface IndirectAdjust {
  label: string;
  amount: number;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * 按对方科目编码归类现金流活动：
 * - 投资活动：涉及固定资产/在建/无形/长期资产（16xx、17xx、15xx、1901）。
 * - 筹资活动：涉及权益类科目（4xxx）。
 * - 其余（收入/费用/债权债务/存货/税费等）：经营活动。
 */
export function classifyActivity(counterCodes: string[]): CashActivity {
  if (counterCodes.some((c) => /^(16|17|15)/.test(c) || c === '1901')) return 'investing';
  if (counterCodes.some((c) => c.startsWith('4'))) return 'financing';
  return 'operating';
}

/** 汇总各活动流入/流出/净额 */
export function sumActivities(movements: CashMovement[]): Record<CashActivity, ActivitySum> {
  const init = (): ActivitySum => ({ inflow: 0, outflow: 0, net: 0 });
  const res: Record<CashActivity, ActivitySum> = { operating: init(), investing: init(), financing: init() };
  for (const m of movements) {
    const a = res[m.activity];
    a.inflow = round2(a.inflow + m.inflow);
    a.outflow = round2(a.outflow + m.outflow);
    a.net = round2(a.inflow - a.outflow);
  }
  return res;
}

/** 直接法现金净增加额 = 三类净额之和 */
export function directNetChange(acts: Record<CashActivity, ActivitySum>): number {
  return round2(acts.operating.net + acts.investing.net + acts.financing.net);
}

/**
 * 间接法净利润调节：以经营活动净额（直接法为口径锚点）强制对齐。
 * 返回调节明细（含"其他调整"结构性差异项）、调整后经营活动净额、plug 与恒等标志。
 */
export function reconcileIndirect(
  netProfit: number,
  adjustments: IndirectAdjust[],
  directOperating: number,
): { items: IndirectAdjust[]; operating: number; plug: number; balanced: boolean } {
  const base = round2(netProfit + adjustments.reduce((s, a) => s + a.amount, 0));
  const plug = round2(directOperating - base);
  const items = Math.abs(plug) >= 0.01 ? [...adjustments, { label: '其他调整（结构性差异）', amount: plug }] : adjustments;
  const operating = round2(base + plug);
  return { items, operating, plug, balanced: Math.abs(operating - directOperating) < 0.01 };
}

export { round2 as round2CF };
