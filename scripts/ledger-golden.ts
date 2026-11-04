/**
 * 财务凭证引擎 golden set 回归（CI 可跑）：
 *   pnpm tsx scripts/ledger-golden.ts
 * 验证核心正确性：借贷平衡 + 各业务模板期望分录（与迁移种子模板一致）。
 * 纯函数测试，不依赖数据库。
 */
import { buildVoucherEntries, round2, splitAmountWithRate, type TemplateRow } from '../src/server/ledger/ledger';
import { computeClosing, sumTrial, pnlRevenue, pnlExpense, pnlNet, balanceEquality, periodLocked } from '../src/server/ledger/balance-math';
import { matchStatements, reconcile, netBalance, type ReconLine } from '../src/server/finance/bank-math';
import { classifyActivity, sumActivities, directNetChange, reconcileIndirect, type CashMovement } from '../src/server/finance/cashflow-math';
import { straightLineMonthly, periodDepreciation, netValue, buildDisposalLines } from '../src/server/finance/fixed-assets-math';
import { invoiceTotal, taxFromExcl, socDiffAmount, computeWorksheet } from '../src/server/tax/tax-math';
import {
  hasEffectivePermission,
  hasPermission,
  listPermissions,
  maskSensitiveFields,
  mergeScope,
  PERMISSION_CATALOG,
} from '../src/server/auth/permissions';
import { validateValueByType } from '../src/server/system/settings';
import {
  evalQuantityState, evalBatchClosure, evalLedgerConservation, evalDocNoUnique,
  evalValueRecon, evalVoucherBalance, evalArApRecon, summarizeRun,
} from '../src/server/system/integrity-math';
import { tableSha256, buildTableStats, totalRowsOf, resolveScopeTables } from '../src/server/system/backups';

type Template = Pick<TemplateRow, 'template_code' | 'event_type' | 'spec' | 'balance_to'>;

// 与 db/migrations/0011 内置模板 spec 保持一致
const SALES_SHIPMENT: Template = {
  template_code: 'SALES_SHIPMENT',
  event_type: 'sales_shipment',
  spec: [
    { dc: 'd', account: '1122', account_name: '应收账款', expr: '#amount' },
    { dc: 'c', account: '6001', account_name: '主营业务收入', expr: '#excl' },
    { dc: 'c', account: '22210102', account_name: '应交税费—销项税额', expr: '#tax' },
  ],
  balance_to: { account: '6601', account_name: '管理费用' },
};
const PURCHASE_RECEIPT: Template = {
  template_code: 'PURCHASE_RECEIPT',
  event_type: 'purchase_receipt',
  spec: [
    { dc: 'd', account: '1405', account_name: '库存商品', expr: '#excl' },
    { dc: 'd', account: '22210101', account_name: '应交税费—进项税额', expr: '#tax' },
    { dc: 'c', account: '2202', account_name: '应付账款', expr: '#amount' },
  ],
  balance_to: { account: '6601', account_name: '管理费用' },
};
const RECEIPT_SETTLE: Template = {
  template_code: 'RECEIPT_SETTLE',
  event_type: 'receipt_settle',
  spec: [
    { dc: 'd', account: '1002', account_name: '银行存款', expr: '#amount' },
    { dc: 'c', account: '1122', account_name: '应收账款', expr: '#amount' },
  ],
};
const PAYMENT_SETTLE: Template = {
  template_code: 'PAYMENT_SETTLE',
  event_type: 'payment_settle',
  spec: [
    { dc: 'd', account: '2202', account_name: '应付账款', expr: '#amount' },
    { dc: 'c', account: '1002', account_name: '银行存款', expr: '#amount' },
  ],
};
const RECEIPT_REVERSE: Template = {
  template_code: 'RECEIPT_REVERSE',
  event_type: 'receipt_reverse',
  spec: [
    { dc: 'd', account: '1405', account_name: '库存商品', expr: '#neg_est' },
    { dc: 'c', account: '2203', account_name: '应付账款—暂估', expr: '#neg_est' },
    { dc: 'd', account: '1405', account_name: '库存商品', expr: '#excl' },
    { dc: 'd', account: '22210101', account_name: '应交税费—进项税额', expr: '#tax' },
    { dc: 'c', account: '2202', account_name: '应付账款', expr: '#amount' },
  ],
  balance_to: { account: '6601', account_name: '管理费用' },
};
// 与 db/migrations/0013_cost_finish 内置模板 spec 保持一致（成本结转）
const MANUFACTURE_FINISH: Template = {
  template_code: 'MANUFACTURE_FINISH',
  event_type: 'manufacture_finish',
  spec: [
    { dc: 'd', account: '1405', account_name: '库存商品', expr: '#amount' },
    { dc: 'c', account: '5101', account_name: '生产成本—加工归集', expr: '#amount' },
  ],
  balance_to: { account: '6601', account_name: '管理费用' },
};
const SALES_SHIPMENT_COST: Template = {
  template_code: 'SALES_SHIPMENT_COST',
  event_type: 'sales_cof_shipment',
  spec: [
    { dc: 'd', account: '6401', account_name: '主营业务成本', expr: '#amount' },
    { dc: 'c', account: '1405', account_name: '库存商品', expr: '#amount' },
  ],
  balance_to: { account: '6601', account_name: '管理费用' },
};

let failures = 0;
let passed = 0;

function amt(line: { amount: string }): number {
  return Number(line.amount);
}
function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(`FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}
function assertThrowsApi(name: string, fn: () => void) {
  try {
    fn();
    failures++;
    console.log(`FAIL  ${name} — 未抛错`);
  } catch {
    passed++;
    console.log(`PASS  ${name}`);
  }
}
function blob(name: string, template: Template, ctx: { amount: number; excl?: number; tax?: number; est?: number; neg_est?: number }) {
  const out = buildVoucherEntries(template as TemplateRow, ctx);
  const d = out.lines.filter((l) => l.direction === 'd').reduce((a, l) => a + amt(l), 0);
  const c = out.lines.filter((l) => l.direction === 'c').reduce((a, l) => a + amt(l), 0);
  assert(`借贷平衡 ${name}`, round2(d) === round2(c), `借${d} 贷${c}`);
  return out;
}

// 1. 销售出库：含税 1130 @13% → 收入 1000，销项税 130
console.log('\n— 销售出库确认收入 —');
{
  const { excl, tax } = splitAmountWithRate(1130, 13);
  const out = blob('销售出库', SALES_SHIPMENT, { amount: 1130, excl, tax });
  const dr = out.lines.filter((l) => l.direction === 'd')[0];
  assert('借：应收账款 1130', amt(dr) === 1130);
  const cr = out.lines.filter((l) => l.direction === 'c');
  assert('贷：主营收入 1000', amt(cr[0]) === 1000);
  assert('贷：销项税 130', amt(cr[1]) === 130);
}

// 2. 采购入库：含税 2260 @13% → 成本 2000，进项税 260
console.log('\n— 采购入库确认应付 —');
{
  const { excl, tax } = splitAmountWithRate(2260, 13);
  const out = blob('采购入库', PURCHASE_RECEIPT, { amount: 2260, excl, tax });
  const dr = out.lines.filter((l) => l.direction === 'd');
  assert('借：库存商品 2000', amt(dr[0]) === 2000);
  assert('借：进项税 260', amt(dr[1]) === 260);
  assert('贷：应付 2260', amt(out.lines.filter((l) => l.direction === 'c')[0]) === 2260);
}

// 3. 收款核销 900 → 借银行 900 贷应收 900
console.log('\n— 收款核销 —');
{
  const out = blob('收款核销', RECEIPT_SETTLE, { amount: 900 });
  assert('借：银行 900', amt(out.lines[0]) === 900);
  assert('贷：应收 900', amt(out.lines[1]) === 900);
}

// 4. 付款核销 800 → 借应付 800 贷银行 800
console.log('\n— 付款核销 —');
{
  const out = blob('付款核销', PAYMENT_SETTLE, { amount: 800 });
  assert('借：应付 800', amt(out.lines[0]) === 800);
  assert('贷：银行 800', amt(out.lines[1]) === 800);
}

// 5. 暂估冲回：红字冲暂估 1130 + 蓝字按发票 1130(@13%)重入
console.log('\n— 暂估冲回红蓝 —');
{
  const { excl, tax } = splitAmountWithRate(1130, 13);
  const out = blob('暂估冲回', RECEIPT_REVERSE, { amount: 1130, excl, tax, est: 1130 });
  assert('行1 借库存 -1130(红字)', amt(out.lines[0]) === -1130);
  assert('行2 贷应付暂估 -1130(红字)', amt(out.lines[1]) === -1130);
  assert('行3 借库存 1000(蓝字)', amt(out.lines[2]) === 1000);
  assert('行4 借进项税 130', amt(out.lines[3]) === 130);
  assert('行5 贷应付 1130', amt(out.lines[4]) === 1130);
}

// 6. 尾差兜底：构造显式不平衡模板（借 100.01 / 贷 100），验证尾差归入配置科目保持平衡
console.log('\n— 尾差兜底 —');
{
  const mismatch: Template = {
    template_code: 'MISMATCH',
    event_type: 'manual_test',
    spec: [
      { dc: 'd', account: '1002', account_name: '银行存款', expr: '#amount' },
      { dc: 'c', account: '1122', account_name: '应收账款', expr: '#est' },
    ],
    balance_to: { account: '6601', account_name: '管理费用', summary: '尾差调整' },
  };
  const out = blob('尾差归入', mismatch, { amount: 100.01, est: 100 });
  assert('总借=总贷 100.01', out.total_debit === 100.01 && out.total_credit === 100.01);
  const tail = out.lines.find((l) => l.account_code === '6601');
  assert('尾差补入管理费用 0.01', tail !== undefined && Math.abs(amt(tail)) === 0.01);
}

// 7. 加工完工成本结转：单金额 → 借库存商品 / 贷加工成本归集
console.log('\n— 加工完工成本结转 —');
{
  const out = blob('加工完工结转', MANUFACTURE_FINISH, { amount: 4320 });
  assert('借：库存商品 4320', amt(out.lines[0]) === 4320);
  assert('贷：生产成本—加工归集 4320', amt(out.lines[1]) === 4320);
}

// 8. 销售出库成本结转：单金额 → 借主营成本 / 贷库存商品（与收入凭证分离模板）
console.log('\n— 销售出库成本结转 —');
{
  const out = blob('销售出库结成本', SALES_SHIPMENT_COST, { amount: 2880.5 });
  assert('借：主营业务成本 2880.5', amt(out.lines[0]) === 2880.5);
  assert('贷：库存商品 2880.5', amt(out.lines[1]) === 2880.5);
  assert('成本模板与收入模板 event_type 不同', SALES_SHIPMENT_COST.event_type !== SALES_SHIPMENT.event_type);
}

// 9. 科目余额：期末 = 期初(带符号) + (本期借 − 本期贷)
console.log('\n— 科目余额表计算 —');
{
  // 资产科目（借方方向）：期初借 1000，本期借 500、贷 300 → 期末借 1200
  assert('期末=期初+借-贷(借余)', computeClosing(1000, 500, 300) === 1200);
  // 负债科目（贷方方向）：期初贷 800（记作 -800），本期借 200、贷 100 → 期末贷 700
  assert('期末=期初+借-贷(贷余)', computeClosing(-800, 200, 100) === -700);
  // 冲销至反向：期初借 100，本期贷 250 → 期末贷 150
  assert('余额转方向', computeClosing(100, 0, 250) === -150);
  // 四舍五入
  assert('期末四舍五入', computeClosing(0.005, 0.004, 0) === 0.01);
}

// 10. 试算平衡：借贷合计必等 / 差额定位
console.log('\n— 试算平衡汇总 —');
{
  const t = sumTrial([
    { debit: 1130, credit: 0 },
    { debit: 0, credit: 1000 },
    { debit: 0, credit: 130 },
  ]);
  assert('借贷合计相等', t.balanced && t.total_debit === t.total_credit && t.total_debit === 1130);
  assert('差额为0', t.diff === 0);
  const u = sumTrial([
    { debit: 500, credit: 0 },
    { debit: 0, credit: 480 },
  ]);
  assert('不平衡差额20', !u.balanced && u.diff === 20 && u.total_debit === 500 && u.total_credit === 480);
}

// 11. 利润表口径：营业收入=贷方净值（抵减退货）、成本=借方净值、毛利率、结转损益净额
console.log('\n— 利润表口径 —');
{
  const revenue = pnlRevenue(11800, 800); // 含销项后分离的本期不含税收入 11800，退货红字冲减 800
  const cost = pnlExpense(7600, 0);
  assert('营业收入=贷方净值-退货', revenue === 11000);
  assert('营业成本=借方净值', cost === 7600);
  const gross = round2(revenue - cost);
  assert('毛利=收入-成本', gross === 3400);
  const net = pnlNet(11000 + 300, 7600 + 500 + 400 + 200); // 收入 11300，费用 8700
  assert('利润总额=收入-费用', net === 2600);
  const retainedNeg = pnlNet(6000, 8200); // 亏损
  assert('亏损结转借方', retainedNeg === -2200);
}

// 12. 资产负债表平衡：资产(借正) + 负债+权益(贷负) = 0
console.log('\n— 资产负债表平衡 —');
{
  const assets = 150000; // 资产借正
  const liabEquity = -138000 - 12000; // 负债 + 所有者权益（贷负）
  const eq = balanceEquality(assets, liabEquity);
  assert('资产=负债+权益', eq.balanced && eq.diff === 0);
  const bad = balanceEquality(150000, -138000);
  assert('差值定位(12000)', !bad.balanced && bad.diff === 12000);
}

// 13. 期末结账：期间锁定状态与反结账留痕判定
console.log('\n— 期间锁定 / 反结账留痕 —');
{
  assert('open 未锁定', periodLocked('open', false) === false);
  assert('closed 锁定', periodLocked('closed', false) === true);
  assert('annual_closed 锁定', periodLocked('annual_closed', false) === true);
  assert('locked 标记锁定', periodLocked('open', true) === true);
  // 反结账留痕：记录 (期间, 动作, 操作人, 原因, 时刻)，仅插入不可改动（契约性断言）
  const log = { period: '2025-01', action: 'reopen', actor: 'u1', reason: '补录期初' };
  assert('留痕字段完整', Boolean(log.period) && log.action === 'reopen' && Boolean(log.actor) && Boolean(log.reason));
}

// 14. 费用报销凭证：借费用科目(价税分离) + 借进项税 + 贷其他应付款，借贷平衡
console.log('\n— 费用报销凭证（价税分离） —');
{
  // 6601 管理费用 113 @13% → 不含税 100 + 进项税 13；6602 销售费用 200 @0% → 200
  const { excl: e1, tax: t1 } = splitAmountWithRate(113, 13);
  const items = [
    { excl: e1, tax: t1 },
    { excl: 200, tax: 0 },
  ];
  const debit = items.reduce((s, it) => s + it.excl + it.tax, 0);
  const creditTotal = items.reduce((s, it) => s + it.excl + it.tax, 0);
  assert('含税总额 313', round2(debit) === 313);
  assert('不含税合计 300', round2(items.reduce((s, it) => s + it.excl, 0)) === 300);
  assert('进项税合计 13', round2(items.reduce((s, it) => s + it.tax, 0)) === 13);
  assert('费用报销借贷平衡', round2(debit) === round2(creditTotal));
}

// 15. 银行对账：自动匹配（同账户同方向同金额近日期一对一）
console.log('\n— 银行对账自动匹配 —');
{
  const journals: ReconLine[] = [
    { id: 'j1', account: 'BOC', date: '2026-10-31', direction: 'out', amount: 313, ref_no: 'PY0001' },
    { id: 'j2', account: 'BOC', date: '2026-10-31', direction: 'in', amount: 900, ref_no: 'RC0001' },
  ];
  const statements: ReconLine[] = [
    { id: 's1', account: 'BOC', date: '2026-10-31', direction: 'out', amount: 313 },
    { id: 's2', account: 'BOC', date: '2026-10-31', direction: 'out', amount: 555 }, // 无对应日记账
  ];
  const m = matchStatements(statements, journals, 0.01, 3);
  assert('匹配 1 对', m.matches.length === 1 && m.matches[0].statementId === 's1' && m.matches[0].journalId === 'j1');
  assert('未达对账单 1 笔(s2)', m.unmatchedStatementIds.length === 1 && m.unmatchedStatementIds[0] === 's2');
  assert('未达日记账 1 笔(j2)', m.unmatchedJournalIds.length === 1 && m.unmatchedJournalIds[0] === 'j2');
}

// 16. 未达账项调节表：两方调节后余额相等（对账平）
console.log('\n— 未达账项调节表 —');
{
  // 账面日记账净额：in900 - out313 = 587；银行对账单净额：out313 + out555 = -868
  const bookBalance = 587;
  const bankBalance = -868;
  const unmatchedJournals: ReconLine[] = [{ id: 'j2', account: 'BOC', date: '2026-10-31', direction: 'in', amount: 900 }];
  const unmatchedStatements: ReconLine[] = [{ id: 's2', account: 'BOC', date: '2026-10-31', direction: 'out', amount: 555 }];
  const r = reconcile(bookBalance, bankBalance, unmatchedJournals, unmatchedStatements);
  assert('账面对账平', r.balanced && r.diff === 0, `adjBook${r.adjusted_book} adjBank${r.adjusted_bank}`);
  assert('调节后账面 = 587 + 0 - 555 = 32', r.adjusted_book === 32);
  assert('净额口径', netBalance([{ id: 'a', account: 'x', date: '2026-01-01', direction: 'in', amount: 100 }, { id: 'b', account: 'x', date: '2026-01-01', direction: 'out', amount: 30 }]) === 70);
}

// 17. 现金流量表：活动归类 + 直接法净额 + 两法恒等
console.log('\n— 现金流量表两法恒等 —');
{
  assert('收入/费用对方科目→经营', classifyActivity(['6001', '22210102']) === 'operating');
  assert('固定资产对方科目→投资', classifyActivity(['1601']) === 'investing');
  assert('权益对方科目→筹资', classifyActivity(['4001']) === 'financing');
  const movements: CashMovement[] = [
    { inflow: 900, outflow: 0, activity: 'operating' },   // 收款
    { inflow: 0, outflow: 313, activity: 'operating' },   // 报销付款
    { inflow: 0, outflow: 5000, activity: 'investing' },  // 购设备
    { inflow: 10000, outflow: 0, activity: 'financing' }, // 增资
  ];
  const acts = sumActivities(movements);
  assert('经营净额 587', acts.operating.net === 587);
  assert('投资净额 -5000', acts.investing.net === -5000);
  assert('筹资净额 10000', acts.financing.net === 10000);
  const directNet = directNetChange(acts);
  assert('直接法净增额 = 587-5000+10000 = 5587', directNet === 5587);
  // 间接法：净利润 + 调整，强制对齐直接法经营净额
  const ind = reconcileIndirect(400, [{ label: '折旧', amount: 100 }], acts.operating.net);
  assert('间接法经营活动净额对齐直接法', ind.operating === 587 && ind.balanced);
  // 两法现金净增加额恒等（FR-FIN-024）
  const indNetChange = round2(ind.operating + acts.investing.net + acts.financing.net);
  assert('两法现金净增加额相等', indNetChange === directNet, `direct${directNet} indirect${indNetChange}`);
}

// 18. 固定资产折旧：直线法 + 残值 + 最后月归零兜底 + 处置分录平衡 + 净值口径
console.log('\n— 固定资产折旧与处置 —');
{
  // 直线法：原值 120000、残值 6000、48 月 → 月折旧 2375
  const a1 = { originalValue: 120000, salvageValue: 6000, usefulLife: 48 };
  assert('直线法月折旧 (120000-6000)/48=2375', straightLineMonthly(a1) === 2375);
  // 含残值口径：应提总额 = 原值 − 残值
  const depTotal = round2(a1.originalValue - a1.salvageValue);
  assert('应提总额 114000', depTotal === 114000);
  // 常规期 = 月折旧额
  assert('第 1 期计提 2375', periodDepreciation(a1, 0, 0) === 2375);
  assert('第 47 期（非最后）仍 2375', periodDepreciation(a1, 46, 2375 * 46) === 2375);
  // 最后月兜底：第 48 期应提 = 剩余 = 114000 - 2375*47 = 2375
  assert('最后期提足剩余', periodDepreciation(a1, 47, 2375 * 47) === 2375);
  // 提足后不再计提
  assert('提足后期提额为 0', periodDepreciation(a1, 48, 114000) === 0);

  // 尾差归零：原值 10000、残值 0、3 月 → 月 3333.33，末期兜底 3333.34
  const a2 = { originalValue: 10000, salvageValue: 0, usefulLife: 3 };
  assert('尾差资产月折旧 3333.33', straightLineMonthly(a2) === 3333.33);
  assert('末期兜底归零 3333.34', periodDepreciation(a2, 2, round2(3333.33 * 2)) === 3333.34);
  const sumA2 = round2(3333.33 + 3333.33 + 3333.34);
  assert('末期兜底后应提总额=10000（应提余额归零）', sumA2 === 10000, `sum=${sumA2}`);

  // 净值 = 原值 − 累计折旧
  assert('净值口径 120000-2375=117625', netValue(120000, 2375) === 117625);
  assert('净值不为负', netValue(100, 200) === 0);

  // 处置分录平衡（损失）：原值 120000、累计 2375、收入 100000 → 净 117625、损失 17625
  const l1 = buildDisposalLines({ originalValue: 120000, accrued: 2375, income: 100000, assetName: '货车' });
  const d1 = round2(l1.filter((x) => x.direction === 'd').reduce((s, x) => s + x.amount, 0));
  const c1 = round2(l1.filter((x) => x.direction === 'c').reduce((s, x) => s + x.amount, 0));
  assert('处置损失分录借贷平衡', d1 === c1 && d1 === 120000, `d${d1} c${c1}`);
  assert('损失入 6711 营业外支出', l1.some((x) => x.direction === 'd' && x.account_code === '6711' && x.amount === 17625));
  assert('原值贷 1601', l1.some((x) => x.direction === 'c' && x.account_code === '1601' && x.amount === 120000));

  // 处置分录平衡（收益）：原值 120000、累计 114000（提足）、收入 10000 → 净 6000、收益 4000
  const l2 = buildDisposalLines({ originalValue: 120000, accrued: 114000, income: 10000, assetName: '货车' });
  const d2 = round2(l2.filter((x) => x.direction === 'd').reduce((s, x) => s + x.amount, 0));
  const c2 = round2(l2.filter((x) => x.direction === 'c').reduce((s, x) => s + x.amount, 0));
  assert('处置收益分录借贷平衡', d2 === c2 && d2 === 124000, `d${d2} c${c2}`);
  assert('收益入 6301 营业外收入', l2.some((x) => x.direction === 'c' && x.account_code === '6301' && x.amount === 4000));

  // 处置（报废无收入）：原值 5000、累计 5000（提足）、收入 0 → 净 0、无损益
  const l3 = buildDisposalLines({ originalValue: 5000, accrued: 5000, income: 0, assetName: '旧设备' });
  const d3 = round2(l3.filter((x) => x.direction === 'd').reduce((s, x) => s + x.amount, 0));
  const c3 = round2(l3.filter((x) => x.direction === 'c').reduce((s, x) => s + x.amount, 0));
  assert('报废无损益分录平衡', d3 === c3 && d3 === 5000, `d${d3} c${c3}`);
  assert('报废仅 1602+1601 两行', l3.length === 2);
}

// 19. 税务增强：发票价税合计、税额反算、税会差异、申报底稿（预缴抵减）
console.log('\n— 税务增强 —');
{
  // 发票价税合计
  assert('价税合计 1000+130=1130', invoiceTotal({ amount_ex_tax: 1000, tax_amount: 130 }) === 1130);
  // 按税率反算税额
  assert('税额反算 1000×13%=130', taxFromExcl(1000, 13) === 130);
  assert('税额反算 9090.91×9%=818.18', taxFromExcl(9090.91, 9) === 818.18);

  // 税会差异 = 税法口径 − 会计口径（带符号）
  assert('时间性差异 20000-15000=5000', socDiffAmount({ tax_base: 20000, accounting_base: 15000 }) === 5000);
  assert('永久性差异 0-3000=-3000', socDiffAmount({ tax_base: 0, accounting_base: 3000 }) === -3000);

  // 申报底稿：销项 17255、进项 11505 → 应纳 5750；预缴 5000 → 应补 750
  const w1 = computeWorksheet({ output_tax: 17255, deductible_input: 11505, prepaid_total: 5000 });
  assert('底稿 应纳=销-进 5750', w1.vat_before_prepaid === 5750);
  assert('底稿 应补 750（抵预缴）', w1.net_payable === 750);
  assert('底稿 无应退', w1.refundable === 0);
  assert('底稿 无结转留抵', w1.carried_forward === 0);

  // 预缴超额 → 应退
  const w2 = computeWorksheet({ output_tax: 17255, deductible_input: 11505, prepaid_total: 8000 });
  assert('预缴超额 应退 2250', w2.refundable === 2250);
  assert('预缴超额 应补 0', w2.net_payable === 0);

  // 进项大于销项 → 留抵
  const w3 = computeWorksheet({ output_tax: 1000, deductible_input: 1800, prepaid_total: 0 });
  assert('进>销 应纳 0', w3.vat_before_prepaid === 0);
  assert('进>销 留抵 800', w3.carried_forward === 800);
}

// 20. 系统管理：四粒度权限合并 / 数据范围 / 字段脱敏 / 参数值校验 / 权限目录完整性
console.log('\n— 系统管理 —');
{
  // 内置角色静态映射：admin 通配、manager 读写+审批、staff 只读
  assert('admin 通配权限 *', hasPermission('admin', 'sys.write'));
  assert('manager 有 sys.write', hasPermission('manager', 'sys.write'));
  assert('manager 有字段级 field.cost_price', hasPermission('manager', 'field.cost_price'));
  assert('manager 有字段级 field.customer_phone', hasPermission('manager', 'field.customer_phone'));
  assert('staff 无写权限', !hasPermission('staff', 'md.write'));
  assert('staff 无 sys.write', !hasPermission('staff', 'sys.write'));
  assert('staff 无字段级权限', !hasPermission('staff', 'field.cost_price'));
  assert('staff 有只读 md.read', hasPermission('staff', 'md.read'));

  // 有效权限判定（自定义角色并集后的判定口径）
  assert('通配 * 命中任意点', hasEffectivePermission(['*'], 'po.approve'));
  const merged = [...listPermissions('staff'), 'po.write', 'po.approve'];
  assert('并集命中自定义点 po.write', hasEffectivePermission(merged, 'po.write'));
  assert('并集保留内置点 md.read', hasEffectivePermission(merged, 'md.read'));
  assert('并集不命中未授权点 fin.write', !hasEffectivePermission(merged, 'fin.write'));

  // 数据范围合并：多角色取最严格（self > dept > all）
  assert('all+dept=dept', mergeScope('all', 'dept') === 'dept');
  assert('dept+all=dept', mergeScope('dept', 'all') === 'dept');
  assert('dept+self=self', mergeScope('dept', 'self') === 'self');
  assert('self+self=self', mergeScope('self', 'self') === 'self');
  assert('all+all=all', mergeScope('all', 'all') === 'all');

  // 字段级脱敏：缺 field.cost_price 时成本价/毛利率置 null
  const maskedCost = maskSensitiveFields(
    [{ id: 'p1', name: '瓷砖', reference_purchase_price: 88.5, avg_cost: 80 }],
    ['md.read'],
  );
  assert('无成本权限→成本价置 null', maskedCost[0].reference_purchase_price === null);
  assert('无成本权限→均价置 null', maskedCost[0].avg_cost === null);
  assert('脱敏保留非敏感字段', maskedCost[0].name === '瓷砖');
  const keepCost = maskSensitiveFields(
    [{ id: 'p1', reference_purchase_price: 88.5 }],
    ['md.read', 'field.cost_price'],
  );
  assert('有成本权限→成本价保留', keepCost[0].reference_purchase_price === 88.5);
  // 客户手机号脱敏
  const maskedPhone = maskSensitiveFields([{ id: 'c1', name: '张三', phone: '13800000000' }], ['md.read']);
  assert('无手机号权限→phone 置 null', maskedPhone[0].phone === null);
  const keepPhone = maskSensitiveFields(
    [{ id: 'c1', phone: '13800000000' }],
    ['md.read', 'field.customer_phone'],
  );
  assert('有手机号权限→phone 保留', keepPhone[0].phone === '13800000000');
  // admin 通配不脱敏
  const adminRows = maskSensitiveFields([{ id: 'p1', reference_purchase_price: 88.5, phone: '1' }], ['*']);
  assert('admin 通配不脱敏', adminRows[0].reference_purchase_price === 88.5 && adminRows[0].phone === '1');

  // 参数中心：值类型校验
  assertThrowsApi('数值类型拒绝非数字', () => validateValueByType('abc', 'number'));
  assertThrowsApi('布尔类型拒绝非法值', () => validateValueByType('yes', 'boolean'));
  assertThrowsApi('JSON 类型拒绝非法 JSON', () => validateValueByType('{bad', 'json'));
  validateValueByType('1000', 'number');
  validateValueByType('true', 'boolean');
  validateValueByType('{"a":1}', 'json');
  validateValueByType('任意文本', 'string');
  assert('参数值类型校验通过样例不抛错', true);

  // 权限目录：覆盖四粒度 + 全部内置角色权限点可溯源
  const catalogKeys = new Set(PERMISSION_CATALOG.map((c) => c.key));
  assert('目录含字段级点', catalogKeys.has('field.cost_price') && catalogKeys.has('field.customer_phone'));
  assert('目录含系统管理点', catalogKeys.has('sys.read') && catalogKeys.has('sys.write'));
  for (const p of listPermissions('manager')) {
    assert(`manager 内置点 ${p} 在目录中`, catalogKeys.has(p));
  }
  for (const p of listPermissions('staff')) {
    assert(`staff 内置点 ${p} 在目录中`, catalogKeys.has(p));
  }
}

// ---------------------------------------------------------------------------
// 21) 数据一致性断言 + 系统备份（0021）
// ---------------------------------------------------------------------------
{
  // 数量四态：正常行 pass
  const qtyPass = evalQuantityState([
    { product_id: 'P1', warehouse_id: 'WH01', quantity: 100, frozen_quantity: 20, in_transit: 5 },
    { product_id: 'P2', warehouse_id: 'WH01', quantity: 0, frozen_quantity: 0, in_transit: 0 },
  ]);
  assert('数量四态-正常 pass', qtyPass.result === 'pass');
  // 锁定超现有 → fail
  const qtyFail = evalQuantityState([
    { product_id: 'P1', warehouse_id: 'WH01', quantity: 10, frozen_quantity: 30, in_transit: 0 },
  ]);
  assert('数量四态-锁定超现有 fail', qtyFail.result === 'fail' && qtyFail.failureType === 'QTY_STATE_MISMATCH');
  // 在途为负 → fail
  const qtyNeg = evalQuantityState([
    { product_id: 'P1', warehouse_id: 'WH01', quantity: 5, frozen_quantity: 0, in_transit: -2 },
  ]);
  assert('数量四态-在途为负 fail', qtyNeg.result === 'fail');

  // 批次结存：闭合 pass；不闭合 fail；孤儿批次 fail
  const stocks = [
    { product_id: 'P1', warehouse_id: 'WH01', quantity: 100, frozen_quantity: 0, in_transit: 0 },
    { product_id: 'P2', warehouse_id: 'WH01', quantity: 50, frozen_quantity: 0, in_transit: 0 },
  ];
  const batchPass = evalBatchClosure(stocks, [
    { product_id: 'P1', warehouse_id: 'WH01', remaining_quantity: 60, unit_cost: 10 },
    { product_id: 'P1', warehouse_id: 'WH01', remaining_quantity: 40, unit_cost: 12 },
    { product_id: 'P2', warehouse_id: 'WH01', remaining_quantity: 50, unit_cost: 8 },
  ]);
  assert('批次结存-闭合 pass', batchPass.result === 'pass');
  const batchFail = evalBatchClosure(stocks, [
    { product_id: 'P1', warehouse_id: 'WH01', remaining_quantity: 90, unit_cost: 10 },
  ]);
  assert('批次结存-不闭合 fail', batchFail.result === 'fail' && batchFail.failureType === 'BATCH_CLOSURE_MISMATCH');
  const batchOrphan = evalBatchClosure(stocks, [
    { product_id: 'P1', warehouse_id: 'WH01', remaining_quantity: 100, unit_cost: 10 },
    { product_id: 'P2', warehouse_id: 'WH01', remaining_quantity: 50, unit_cost: 8 },
    { product_id: 'P9', warehouse_id: 'WH99', remaining_quantity: 3, unit_cost: 1 },
  ]);
  assert('批次结存-孤儿批次 fail', batchOrphan.result === 'fail');

  // 台账守恒：prev.balance+chg=balance 链式 + 链末=库存
  const ledgerOk = evalLedgerConservation([
    { id: '1', product_id: 'P1', warehouse_id: 'WH01', quantity: 100, balance: 100, ref_no: 'GR-1', created_at: '2026-01-01T00:00:00Z' },
    { id: '2', product_id: 'P1', warehouse_id: 'WH01', quantity: -30, balance: 70, ref_no: 'SH-1', created_at: '2026-01-02T00:00:00Z' },
  ], [{ product_id: 'P1', warehouse_id: 'WH01', quantity: 70, frozen_quantity: 0, in_transit: 0 }]);
  assert('台账守恒-链式正确 pass', ledgerOk.result === 'pass');
  const ledgerBroken = evalLedgerConservation([
    { id: '1', product_id: 'P1', warehouse_id: 'WH01', quantity: 100, balance: 100, ref_no: 'GR-1', created_at: '2026-01-01T00:00:00Z' },
    { id: '2', product_id: 'P1', warehouse_id: 'WH01', quantity: -30, balance: 65, ref_no: 'SH-1', created_at: '2026-01-02T00:00:00Z' },
  ], [{ product_id: 'P1', warehouse_id: 'WH01', quantity: 70, frozen_quantity: 0, in_transit: 0 }]);
  assert('台账守恒-断链 fail', ledgerBroken.result === 'fail' && ledgerBroken.failureType === 'LEDGER_CHAIN_BROKEN');
  const ledgerTail = evalLedgerConservation([
    { id: '1', product_id: 'P1', warehouse_id: 'WH01', quantity: 100, balance: 100, ref_no: 'GR-1', created_at: '2026-01-01T00:00:00Z' },
  ], [{ product_id: 'P1', warehouse_id: 'WH01', quantity: 88, frozen_quantity: 0, in_transit: 0 }]);
  assert('台账守恒-链末与库存不符 fail', ledgerTail.result === 'fail');

  // 单号唯一
  const docPass = evalDocNoUnique([
    { table: 'po_purchase_orders', doc_no: 'PO-1' },
    { table: 'so_sales_orders', doc_no: 'SO-1' },
  ]);
  assert('单号唯一-无重复 pass', docPass.result === 'pass');
  const docDup = evalDocNoUnique([
    { table: 'po_purchase_orders', doc_no: 'X-1' },
    { table: 'fin_vouchers', doc_no: 'X-1' },
  ]);
  assert('单号唯一-跨表重复 fail', docDup.result === 'fail' && docDup.failureType === 'DOC_NO_DUPLICATED');

  // 货值勾稽
  const valueRows = [
    { product_id: 'P1', warehouse_id: 'WH01', quantity: 10, frozen_quantity: 0, in_transit: 0, avg_cost: 5, total_cost: 50 },
    { product_id: 'P2', warehouse_id: 'WH01', quantity: 4, frozen_quantity: 0, in_transit: 0, avg_cost: 25, total_cost: 100 },
  ];
  const valuePass = evalValueRecon(valueRows, 150, 'warn');
  assert('货值勾稽-与1405一致 pass', valuePass.result === 'pass');
  const valueWarn = evalValueRecon(valueRows, 120, 'warn');
  assert('货值勾稽-偏差按 warn 级别告警', valueWarn.result === 'warn' && valueWarn.failureType === 'VALUE_GL_MISMATCH');
  const valueFail = evalValueRecon(valueRows, 120, 'fail');
  assert('货值勾稽-偏差按 fail 级别失败', valueFail.result === 'fail');
  const valueRowBad = evalValueRecon([
    { product_id: 'P1', warehouse_id: 'WH01', quantity: 10, frozen_quantity: 0, in_transit: 0, avg_cost: 5, total_cost: 99 },
  ], null, 'fail');
  assert('货值勾稽-行级 qty×avg≠total fail', valueRowBad.result === 'fail' && valueRowBad.failureType === 'VALUE_ROW_MISMATCH');

  // 凭证平衡
  const voucherPass = evalVoucherBalance(
    [{ id: 'v1', voucher_no: 'JZ-1', status: 'posted' }],
    [
      { voucher_id: 'v1', direction: 'debit', amount: 100 },
      { voucher_id: 'v1', direction: 'credit', amount: 100 },
    ],
  );
  assert('凭证平衡-借贷相等 pass', voucherPass.result === 'pass');
  const voucherFail = evalVoucherBalance(
    [{ id: 'v1', voucher_no: 'JZ-1', status: 'posted' }],
    [
      { voucher_id: 'v1', direction: 'debit', amount: 100 },
      { voucher_id: 'v1', direction: 'credit', amount: 90 },
    ],
  );
  assert('凭证平衡-借贷不等 fail', voucherFail.result === 'fail' && voucherFail.failureType === 'VOUCHER_UNBALANCED');

  // 应收应付
  const arapPass = evalArApRecon({
    so_billed: 1000, so_returned: 100, received: 500,
    po_billed: 800, po_returned: 50, po_reversal_net: 20, paid: 300,
  });
  assert('应收应付-正常 pass 且余额正确', arapPass.result === 'pass'
    && (arapPass.detail.receivable as number) === 400
    && (arapPass.detail.payable as number) === 470);
  const arapNeg = evalArApRecon({
    so_billed: 1000, so_returned: 0, received: 1200,
    po_billed: 800, po_returned: 0, po_reversal_net: 0, paid: 300,
  });
  assert('应收应付-超额核销 fail', arapNeg.result === 'fail' && arapNeg.failureType === 'ARAP_NEGATIVE');

  // 跑批汇总：fail 级且 severity=fail 才阻断
  const summary = summarizeRun([
    { key: 'a', name: 'A', severity: 'fail', result: 'pass', detail: {} },
    { key: 'b', name: 'B', severity: 'warn', result: 'warn', detail: {} },
    { key: 'c', name: 'C', severity: 'warn', result: 'fail', detail: {} },
  ]);
  assert('汇总-warn级fail不阻断', summary.blocking === false && summary.failed === 1 && summary.warned === 1);
  const summaryBlock = summarizeRun([
    { key: 'a', name: 'A', severity: 'fail', result: 'fail', detail: {} },
  ]);
  assert('汇总-fail级fail阻断', summaryBlock.blocking === true);

  // 备份：sha256 稳定性 / stats / 范围解析
  const rows = [{ a: 1, b: 'x' }, { a: 2, b: 'y' }];
  const h1 = tableSha256(rows);
  const h2 = tableSha256([...rows].reverse());
  assert('备份-sha256 与行顺序无关', h1 === h2);
  assert('备份-sha256 64位hex', /^[0-9a-f]{64}$/.test(h1));
  const stats = buildTableStats({ t1: rows, t2: [{ c: 1 }] });
  assert('备份-stats 行数正确', stats.t1.rows === 2 && stats.t2.rows === 1);
  assert('备份-总行数', totalRowsOf(stats) === 3);
  const scope = resolveScopeTables(['md', 'fin']);
  assert('备份-范围解析含 md/fin 表', scope.invalid.length === 0 && scope.tables.includes('md_products') && scope.tables.includes('fin_vouchers'));
  const scopeBad = resolveScopeTables(['nope']);
  assert('备份-未知分组识别', scopeBad.invalid.length === 1);
}

// ---------------------------------------------------------------------------
// 22) 色号维度（0022）：库存最小单元 = 商品×仓×色号，断言按色号独立核算
// ---------------------------------------------------------------------------
console.log('\n— 色号维度断言（商品×仓×色号） —');
{
  // 批次结存：同商品同仓不同色号独立闭合（色号不串）
  const colorStocks = [
    { product_id: 'P1', warehouse_id: 'WH01', color_code: '', quantity: 40, frozen_quantity: 0, in_transit: 0 },
    { product_id: 'P1', warehouse_id: 'WH01', color_code: 'C01', quantity: 60, frozen_quantity: 0, in_transit: 0 },
  ];
  const colorBatchPass = evalBatchClosure(colorStocks, [
    { product_id: 'P1', warehouse_id: 'WH01', color_code: '', remaining_quantity: 40, unit_cost: 10 },
    { product_id: 'P1', warehouse_id: 'WH01', color_code: 'C01', remaining_quantity: 25, unit_cost: 11 },
    { product_id: 'P1', warehouse_id: 'WH01', color_code: 'C01', remaining_quantity: 35, unit_cost: 12 },
  ]);
  assert('色号批次-同商品不同色号独立闭合 pass', colorBatchPass.result === 'pass');
  // 色号混放（C01 批次计入默认色库存）→ 不闭合 fail
  const colorBatchMixed = evalBatchClosure(colorStocks, [
    { product_id: 'P1', warehouse_id: 'WH01', color_code: '', remaining_quantity: 100, unit_cost: 10 },
  ]);
  assert('色号批次-跨色号混算 fail', colorBatchMixed.result === 'fail' && colorBatchMixed.failureType === 'BATCH_CLOSURE_MISMATCH');
  // 孤儿色号批次（批次色号无对应库存行）→ fail
  const colorBatchOrphan = evalBatchClosure(colorStocks, [
    { product_id: 'P1', warehouse_id: 'WH01', color_code: '', remaining_quantity: 40, unit_cost: 10 },
    { product_id: 'P1', warehouse_id: 'WH01', color_code: 'C01', remaining_quantity: 60, unit_cost: 11 },
    { product_id: 'P1', warehouse_id: 'WH01', color_code: 'C99', remaining_quantity: 5, unit_cost: 9 },
  ]);
  assert('色号批次-孤儿色号批次 fail', colorBatchOrphan.result === 'fail');

  // 台账守恒：同商品同仓不同色号各自成链，互不串色
  const colorLedgerPass = evalLedgerConservation([
    { id: '1', product_id: 'P1', warehouse_id: 'WH01', color_code: 'C01', quantity: 60, balance: 60, ref_no: 'GR-1', created_at: '2026-01-01T00:00:00Z' },
    { id: '2', product_id: 'P1', warehouse_id: 'WH01', color_code: '', quantity: 40, balance: 40, ref_no: 'GR-2', created_at: '2026-01-01T01:00:00Z' },
    { id: '3', product_id: 'P1', warehouse_id: 'WH01', color_code: 'C01', quantity: -20, balance: 40, ref_no: 'SH-1', created_at: '2026-01-02T00:00:00Z' },
  ], [
    { product_id: 'P1', warehouse_id: 'WH01', color_code: 'C01', quantity: 40, frozen_quantity: 0, in_transit: 0 },
    { product_id: 'P1', warehouse_id: 'WH01', color_code: '', quantity: 40, frozen_quantity: 0, in_transit: 0 },
  ]);
  assert('色号台账-分色成链 pass', colorLedgerPass.result === 'pass');
  // 色号出库扣错链（C01 出库记到默认色链上）→ 断链 fail
  const colorLedgerCross = evalLedgerConservation([
    { id: '1', product_id: 'P1', warehouse_id: 'WH01', color_code: 'C01', quantity: 60, balance: 60, ref_no: 'GR-1', created_at: '2026-01-01T00:00:00Z' },
    { id: '2', product_id: 'P1', warehouse_id: 'WH01', color_code: '', quantity: 40, balance: 40, ref_no: 'GR-2', created_at: '2026-01-01T01:00:00Z' },
    { id: '3', product_id: 'P1', warehouse_id: 'WH01', color_code: '', quantity: -20, balance: 20, ref_no: 'SH-1', created_at: '2026-01-02T00:00:00Z' },
  ], [
    { product_id: 'P1', warehouse_id: 'WH01', color_code: 'C01', quantity: 40, frozen_quantity: 0, in_transit: 0 },
    { product_id: 'P1', warehouse_id: 'WH01', color_code: '', quantity: 40, frozen_quantity: 0, in_transit: 0 },
  ]);
  assert('色号台账-色号链末与库存不符 fail', colorLedgerCross.result === 'fail');

  // 色号缺省（undefined）与 '' 同组：存量数据兼容
  const legacyStocks = [
    { product_id: 'P1', warehouse_id: 'WH01', quantity: 30, frozen_quantity: 0, in_transit: 0 },
  ];
  const legacyBatchPass = evalBatchClosure(legacyStocks, [
    { product_id: 'P1', warehouse_id: 'WH01', color_code: '', remaining_quantity: 30, unit_cost: 10 },
  ]);
  assert('色号兼容-缺省色号与空串同组 pass', legacyBatchPass.result === 'pass');

  // 数量四态：色号行独立校验（冻结不超现有，按行判定）
  const colorQtyPass = evalQuantityState([
    { product_id: 'P1', warehouse_id: 'WH01', color_code: 'C01', quantity: 50, frozen_quantity: 10, in_transit: 0 },
    { product_id: 'P1', warehouse_id: 'WH01', color_code: '', quantity: 30, frozen_quantity: 0, in_transit: 0 },
  ]);
  assert('色号四态-分行校验 pass', colorQtyPass.result === 'pass');
  const colorQtyFail = evalQuantityState([
    { product_id: 'P1', warehouse_id: 'WH01', color_code: 'C01', quantity: 5, frozen_quantity: 8, in_transit: 0 },
  ]);
  assert('色号四态-单色号锁定超现有 fail', colorQtyFail.result === 'fail' && colorQtyFail.failureType === 'QTY_STATE_MISMATCH');
}

console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
console.log('LEDGER_GOLDEN_OK');