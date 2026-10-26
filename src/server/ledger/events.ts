/**
 * 业务事件 → 记账凭证 + 税额登记 的统一接入层
 * 每个事件函数幂等：凭证按 event 唯一、税额按 (ref_type,ref_id,tax_type) 唯一。
 * 由各业务终审/核销服务在成功落库后调用。
 */
import { getSupabaseClient } from "@/storage/database/supabase-client";
import { ApiError } from "@/server/http";
import { ensureVoucher, splitAmountWithRate, round2, EVENT_SALES_SHIPMENT, EVENT_PURCHASE_RECEIPT, EVENT_RECEIPT_SETTLE, EVENT_PAYMENT_SETTLE, EVENT_RECEIPT_REVERSE } from "@/server/ledger/ledger";
import { registerTaxEntry, TAX_OUTPUT, TAX_INPUT } from "@/server/tax/tax";

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