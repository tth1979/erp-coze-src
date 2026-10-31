/**
 * 业务事件 → 记账凭证 + 税额登记 的统一接入层
 * 每个事件函数幂等：凭证按 event 唯一、税额按 (ref_type,ref_id,tax_type) 唯一。
 * 由各业务终审/核销服务在成功落库后调用。
 */
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { ApiError } from "@/server/http";
import { ensureVoucher, ensurePostedVoucherLines, splitAmountWithRate, round2, EVENT_SALES_SHIPMENT, EVENT_PURCHASE_RECEIPT, EVENT_RECEIPT_SETTLE, EVENT_PAYMENT_SETTLE, EVENT_RECEIPT_REVERSE, EVENT_SALES_SHIPMENT_COST, EVENT_MANUFACTURE_FINISH, EVENT_EXPENSE_CLAIM, EVENT_EXPENSE_PAY, EVENT_DEPRECIATION, EVENT_ASSET_DISPOSAL } from "@/server/ledger/ledger";
import { registerTaxEntry, TAX_OUTPUT, TAX_INPUT } from "@/server/tax/tax";
import { buildDisposalLines } from "@/server/finance/fixed-assets-math";

export interface ItemAmount {
  product_id: string;
  quantity: number;
  unit_price: number;
}

const DEFAULT_TAX_RATE = 13;

/** 查询商品税率表（缺省 13%） */
async function loadTaxRates(productIds: string[]): Promise<Map<string, number>> {
  const supabase = getSupabaseClient();
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from('md_products')
    .select('id, tax_rate')
    .in('id', ids);
  if (error) throw new ApiError(500, 'DB', error.message);
  const map = new Map<string, number>();
  for (const r of data ?? []) map.set(r.id, Number(r.tax_rate ?? DEFAULT_TAX_RATE));
  return map;
}

/** 按商品税率拆分 含税总额 → 不含税 + 税额（多税率聚合），返回主税率 */
export async function computeItemsTax(
  items: ItemAmount[],
): Promise<{ total: number; excl: number; tax: number; rate: number }> {
  const rates = await loadTaxRates(items.map((i) => i.product_id));
  let total = 0;
  let tax = 0;
  let mainRate = DEFAULT_TAX_RATE;
  for (const it of items) {
    const amount = round2(it.quantity * it.unit_price);
    total = round2(total + amount);
    const rate = rates.get(it.product_id) ?? DEFAULT_TAX_RATE;
    if (items.indexOf(it) === 0) mainRate = rate;
    tax = round2(tax + splitAmountWithRate(amount, rate).tax);
  }
  return { total, excl: round2(total - tax), tax, rate: mainRate };
}

const todayStr = () => new Date().toISOString().slice(0, 10);

export async function fetchCustomerName(id: string): Promise<string> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.from('md_customers').select('name').eq('id', id).maybeSingle();
  return data?.name ?? '';
}
export async function fetchSupplierName(id: string): Promise<string> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.from('md_suppliers').select('name').eq('id', id).maybeSingle();
  return data?.name ?? '';
}

/** 销售出库 → 确认收入凭证 + 销项税登记 */
export async function onSalesShipment(args: {
  shipment_id: string;
  shipment_no: string;
  customer_name: string;
  items: ItemAmount[];
  operatorId: string;
  date?: string;
}) {
  const { total, excl, tax, rate } = await computeItemsTax(args.items);
  await ensureVoucher({
    event_type: EVENT_SALES_SHIPMENT,
    event_id: args.shipment_id,
    voucher_date: args.date ?? todayStr(),
    ref_no: args.shipment_no,
    ref_summary: `销售出库：${args.customer_name}`,
    template_code: 'SALES_SHIPMENT',
    ctx: { amount: total, excl, tax },
    operatorId: args.operatorId,
  });
  await registerTaxEntry({
    tax_type: TAX_OUTPUT,
    period: (args.date ?? todayStr()).slice(0, 7),
    tax_rate: rate,
    amount: total,
    base_amount: excl,
    tax_amount: tax,
    doc_no: args.shipment_no,
    ref_type: 'shipment',
    ref_id: args.shipment_id,
    operatorId: args.operatorId,
  });
}

/** 采购入库 → 确认应付凭证 + 进项税登记（暂估单不确认进项税） */
export async function onPurchaseReceipt(args: {
  receipt_id: string;
  receipt_no: string;
  supplier_name: string;
  is_estimated: boolean;
  items: ItemAmount[];
  operatorId: string;
  date?: string;
}) {
  const { total, excl, tax, rate } = await computeItemsTax(args.items);
  const ctxTax = args.is_estimated ? 0 : tax;
  const ctxExcl = args.is_estimated ? total : excl;
  await ensureVoucher({
    event_type: EVENT_PURCHASE_RECEIPT,
    event_id: args.receipt_id,
    voucher_date: args.date ?? todayStr(),
    ref_no: args.receipt_no,
    ref_summary: `采购入库：${args.supplier_name}${args.is_estimated ? '（暂估）' : ''}`,
    template_code: 'PURCHASE_RECEIPT',
    ctx: { amount: total, excl: ctxExcl, tax: ctxTax },
    operatorId: args.operatorId,
  });
  if (!args.is_estimated) {
    await registerTaxEntry({
      tax_type: TAX_INPUT,
      period: (args.date ?? todayStr()).slice(0, 7),
      tax_rate: rate,
      amount: total,
      base_amount: excl,
      tax_amount: tax,
      doc_no: args.receipt_no,
      ref_type: 'receipt',
      ref_id: args.receipt_id,
      operatorId: args.operatorId,
    });
  }
}

/** 收款核销 → 借银行贷应收 凭证 */
export async function onReceiptSettle(args: {
  payment_id: string;
  doc_no: string;
  partner: string;
  amount: number;
  paid_at?: string;
  operatorId: string;
}) {
  await ensureVoucher({
    event_type: EVENT_RECEIPT_SETTLE,
    event_id: args.payment_id,
    voucher_date: args.paid_at ?? todayStr(),
    ref_no: args.doc_no,
    ref_summary: `收款核销：${args.partner}`,
    template_code: 'RECEIPT_SETTLE',
    ctx: { amount: args.amount },
    operatorId: args.operatorId,
  });
}

/** 付款核销 → 借应付贷银行 凭证 */
export async function onPaymentSettle(args: {
  payment_id: string;
  doc_no: string;
  partner: string;
  amount: number;
  paid_at?: string;
  operatorId: string;
}) {
  await ensureVoucher({
    event_type: EVENT_PAYMENT_SETTLE,
    event_id: args.payment_id,
    voucher_date: args.paid_at ?? todayStr(),
    ref_no: args.doc_no,
    ref_summary: `付款核销：${args.partner}`,
    template_code: 'PAYMENT_SETTLE',
    ctx: { amount: args.amount },
    operatorId: args.operatorId,
  });
}

/** 销售出库成本结转：借主营成本，贷库存商品（与确认收入凭证区分模板，同 event_id 幂等） */
export async function onSalesShipmentCost(args: {
  shipment_id: string;
  shipment_no: string;
  cost: number;
  operatorId: string;
  date?: string;
}) {
  await ensureVoucher({
    event_type: EVENT_SALES_SHIPMENT_COST,
    event_id: args.shipment_id,
    voucher_date: args.date ?? todayStr(),
    ref_no: args.shipment_no,
    ref_summary: `销售成本结转：${args.shipment_no}`,
    template_code: 'SALES_SHIPMENT_COST',
    ctx: { amount: args.cost },
    operatorId: args.operatorId,
  });
}

/** 加工完工成本结转：借库存产成品，贷加工成本归集（差额按损耗处理）。仅在加工单全部完工后记账，幂等。 */
export async function onManufactureFinish(args: {
  order_id: string;
  doc_no: string;
  cost: number;
  operatorId: string;
  date?: string;
}) {
  await ensureVoucher({
    event_type: EVENT_MANUFACTURE_FINISH,
    event_id: args.order_id,
    voucher_date: args.date ?? todayStr(),
    ref_no: args.doc_no,
    ref_summary: `加工完工成本结转：${args.doc_no}`,
    template_code: 'MANUFACTURE_FINISH',
    ctx: { amount: args.cost },
    operatorId: args.operatorId,
  });
}

/** 暂估冲回 → 红字冲销暂估 + 蓝字按发票价重入 凭证（一套）+ 蓝字进项税登记 */
export async function onReceiptReverse(args: {
  receipt_id: string;
  receipt_no: string;
  supplier_name: string;
  est_total: number;
  invoice_items: ItemAmount[];
  operatorId: string;
  date?: string;
}) {
  const { total, excl, tax, rate } = await computeItemsTax(args.invoice_items);
  const est = args.est_total;
  await ensureVoucher({
    event_type: EVENT_RECEIPT_REVERSE,
    event_id: args.receipt_id,
    voucher_date: args.date ?? todayStr(),
    ref_no: args.receipt_no,
    ref_summary: `暂估冲回：${args.supplier_name}`,
    template_code: 'RECEIPT_REVERSE',
    ctx: { amount: total, excl, tax, est },
    operatorId: args.operatorId,
  });
  await registerTaxEntry({
    tax_type: TAX_INPUT,
    period: (args.date ?? todayStr()).slice(0, 7),
    tax_rate: rate,
    amount: total,
    base_amount: excl,
    tax_amount: tax,
    doc_no: args.receipt_no,
    ref_type: 'receipt_reverse',
    ref_id: args.receipt_id,
    operatorId: args.operatorId,
  });
}

/**
 * 费用报销审核通过 → 费用确认凭证（借各费用科目 + 可抵进项税 / 贷其他应付款-员工）。
 * 支持多费用科目：按明细逐行建借方分录，贷方合计=含税总额。幂等（event=expense_claim, id=报销单）。
 */
export async function onExpenseApprove(args: {
  claim_id: string;
  claim_no: string;
  applicant: string;
  items: { subject_code: string; excl_amount: number; tax_amount: number; summary?: string }[];
  credit_account: string;
  credit_account_name: string;
  operatorId: string;
  date?: string;
}) {
  const lines: { direction: 'd' | 'c'; account_code: string; amount: number; summary?: string }[] = args.items
    .filter((it) => Math.abs(it.excl_amount) >= 0.005)
    .map((it) => ({
      direction: 'd' as const,
      account_code: it.subject_code,
      amount: round2(it.excl_amount),
      summary: it.summary,
    }));
  const taxSum = round2(args.items.reduce((s, it) => s + (it.tax_amount || 0), 0));
  if (taxSum > 0.005) {
    lines.push({ direction: 'd' as const, account_code: '22210101', amount: taxSum, summary: '可抵扣进项税额' });
  }
  const creditTotal = round2(args.items.reduce((s, it) => s + it.excl_amount + (it.tax_amount || 0), 0));
  lines.push({
    direction: 'c' as const,
    account_code: args.credit_account,
    amount: creditTotal,
    summary: `应付${args.applicant}报销款`,
  });
  await ensurePostedVoucherLines({
    event_type: EVENT_EXPENSE_CLAIM,
    event_id: args.claim_id,
    voucher_date: args.date ?? todayStr(),
    ref_no: args.claim_no,
    ref_summary: `费用报销：${args.applicant}`,
    template_code: 'EXPENSE_CLAIM',
    lines,
    operatorId: args.operatorId,
  });
}

/** 费用报销付款 → 借其他应付款 贷银行存款 凭证（幂等，event=expense_pay, id=报销单） */
export async function onExpensePay(args: {
  claim_id: string;
  claim_no: string;
  applicant: string;
  amount: number;
  debit_account: string;
  operatorId: string;
  date?: string;
}) {
  await ensurePostedVoucherLines({
    event_type: EVENT_EXPENSE_PAY,
    event_id: args.claim_id,
    voucher_date: args.date ?? todayStr(),
    ref_no: args.claim_no,
    ref_summary: `报销付款：${args.applicant}`,
    template_code: 'EXPENSE_PAY',
    lines: [
      { direction: 'd', account_code: args.debit_account, amount: round2(args.amount), summary: `支付${args.applicant}报销款` },
      { direction: 'c', account_code: '1002', amount: round2(args.amount), summary: '银行付款' },
    ],
    operatorId: args.operatorId,
  });
}

/**
 * 固定资产月度计提 → 折旧凭证（借 折旧费用科目 / 贷 1602 累计折旧）。
 * 幂等（event=depreciation, id=期间:资产），同一资产同一期间只生成一次。
 */
export async function onDepreciation(args: {
  asset_id: string;
  asset_no: string;
  asset_name: string;
  period: string;
  amount: number;
  expense_subject: string; // 折旧费用科目（末级，默认 6601）
  operatorId: string;
  date?: string;
}) {
  const v = await ensurePostedVoucherLines({
    event_type: EVENT_DEPRECIATION,
    event_id: `${args.period}:${args.asset_id}`,
    voucher_date: args.date ?? todayStr(),
    ref_no: args.asset_no,
    ref_summary: `计提折旧：${args.asset_name}（${args.period}）`,
    template_code: 'DEPRECIATION',
    lines: [
      { direction: 'd', account_code: args.expense_subject, amount: round2(args.amount), summary: `计提折旧：${args.asset_name}` },
      { direction: 'c', account_code: '1602', amount: round2(args.amount), summary: `累计折旧：${args.asset_name}` },
    ],
    operatorId: args.operatorId,
  });
  return v;
}

/**
 * 固定资产处置 → 处置凭证（借 累计折旧+处置收入或损失 / 贷 固定资产原值+处置收益）。
 * 处置损失借 6711 营业外支出、处置收益贷 6301 营业外收入，借贷恒平衡。
 * 幂等（event=asset_disposal, id=资产）。
 */
export async function onAssetDisposal(args: {
  asset_id: string;
  asset_no: string;
  asset_name: string;
  original_value: number;
  accrued: number;
  income: number;
  operatorId: string;
  date?: string;
}) {
  const lines = buildDisposalLines({
    originalValue: args.original_value,
    accrued: args.accrued,
    income: args.income,
    assetName: args.asset_name,
  });
  const v = await ensurePostedVoucherLines({
    event_type: EVENT_ASSET_DISPOSAL,
    event_id: args.asset_id,
    voucher_date: args.date ?? todayStr(),
    ref_no: args.asset_no,
    ref_summary: `处置固定资产：${args.asset_name}`,
    template_code: 'ASSET_DISPOSAL',
    lines: lines.map((l) => ({ direction: l.direction, account_code: l.account_code, amount: l.amount, summary: l.summary })),
    operatorId: args.operatorId,
  });
  return v;
}