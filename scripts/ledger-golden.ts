/**
 * 财务凭证引擎 golden set 回归（CI 可跑）：
 *   pnpm tsx scripts/ledger-golden.ts
 * 验证核心正确性：借贷平衡 + 各业务模板期望分录（与迁移种子模板一致）。
 * 纯函数测试，不依赖数据库。
 */
import { buildVoucherEntries, round2, splitAmountWithRate, type TemplateRow } from '../src/server/ledger/ledger';
import { computeClosing, sumTrial } from '../src/server/ledger/balance-math';

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

console.log(`\n${passed} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
console.log('LEDGER_GOLDEN_OK');