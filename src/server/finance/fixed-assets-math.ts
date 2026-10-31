/**
 * 固定资产折旧与处置 —— 纯函数（供 golden set 直接回归，不触库）
 *
 * 口径：
 * - 直线法月折旧额 = (原值 − 残值) / 使用年限(月)
 * - 已提期数达到 useful_life 前的最后一期，兜底把剩余应提一次性提完（净额归零，含四舍五入尾差）。
 * - 净值 = 原值 − 累计折旧。
 * - 处置损益 = 处置收入 − 处置时净值；收益贷 6301、损失借 6711；处置分录恒平衡。
 */

export interface StraightLineInput {
  originalValue: number;
  salvageValue: number;
  usefulLife: number; // 月
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 直线法月折旧额（常规期） */
export function straightLineMonthly(input: StraightLineInput): number {
  const depreciable = round2(input.originalValue - input.salvageValue);
  if (depreciable <= 0 || input.usefulLife <= 0) return 0;
  return round2(depreciable / input.usefulLife);
}

/**
 * 某一期应提折旧额。
 * @param monthsAccrued 已计提期数（不含本期）
 * @param accruedBefore 已累计计提金额
 * 常规期 = 月折旧额；当 (monthsAccrued + 1) === usefulLife 即最后一期时，
 * 兜底 = 剩余应提（原值−残值−已提），保证提足后净额=残值、应提余额归零。
 */
export function periodDepreciation(
  input: StraightLineInput,
  monthsAccrued: number,
  accruedBefore: number,
): number {
  const depreciable = round2(input.originalValue - input.salvageValue);
  if (depreciable <= 0 || input.usefulLife <= 0) return 0;
  if (monthsAccrued >= input.usefulLife) return 0;
  const remaining = round2(depreciable - accruedBefore);
  if (remaining <= 0) return 0;
  if (monthsAccrued + 1 >= input.usefulLife) return remaining; // 最后一期兜底归零
  return Math.min(straightLineMonthly(input), remaining);
}

/** 净值 = 原值 − 累计折旧（不低于 0） */
export function netValue(originalValue: number, accrued: number): number {
  return Math.max(round2(originalValue - accrued), 0);
}

/**
 * 处置分录（借贷恒平衡）。
 * 借：1602 累计折旧(累计) + [1002 银行存款(收入)] + [6711 营业外支出(损失=净值−收入)]
 * 贷：1601 固定资产(原值) + [6301 营业外收入(收益=收入−净值)]
 */
export interface DisposalLine {
  direction: 'd' | 'c';
  account_code: string;
  amount: number;
  summary: string;
}

export function buildDisposalLines(input: {
  originalValue: number;
  accrued: number;
  income: number;
  assetName: string;
}): DisposalLine[] {
  const { originalValue, accrued, income, assetName } = input;
  const net = netValue(originalValue, accrued);
  const gain = round2(income - net); // >0 收益 / <0 损失
  const lines: DisposalLine[] = [];
  if (accrued > 0.005) {
    lines.push({ direction: 'd', account_code: '1602', amount: round2(accrued), summary: `转出累计折旧：${assetName}` });
  }
  if (income > 0.005) {
    lines.push({ direction: 'd', account_code: '1002', amount: round2(income), summary: `处置收入：${assetName}` });
  }
  if (gain < -0.005) {
    lines.push({ direction: 'd', account_code: '6711', amount: round2(-gain), summary: `处置损失：${assetName}` });
  }
  lines.push({ direction: 'c', account_code: '1601', amount: round2(originalValue), summary: `转出固定资产：${assetName}` });
  if (gain > 0.005) {
    lines.push({ direction: 'c', account_code: '6301', amount: round2(gain), summary: `处置收益：${assetName}` });
  }
  return lines;
}
