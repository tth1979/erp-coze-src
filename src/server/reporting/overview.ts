/**
 * 经营统计-汇总看板
 *
 * 指标口径：
 * - 采购总额     = Σ(received 采购订单 total_amount)
 * - 销售总额     = Σ(shipped 销售订单 total_amount) − Σ(approved 销售退货 total_amount)
 * - 毛利         = Σ(shipped 销售订单 total_amount) − Σ(approved 出库单 total_cost)
 * - 应收余额     = Σ(shipped 销售订单) − Σ(approved 销售退货) − Σ(收款)
 * - 应付余额     = Σ(received 采购订单) − Σ(approved 采购退货) − Σ(付款)
 * - 库存总值     = Σ(inv_stock.quantity × avg_cost)（跨仓）
 * - 库存品项     = 库存有货的商品数（跨仓去重）
 *
 * SDK-only 内存聚合：一次性拉取单据后按日期分桶。
 */
import { throwDbError } from '@/server/master-data/helpers';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { currentMonthKey, monthKey, recentMonthKeys, round2, todayKey, toNum } from './shared';

export interface TrendPoint {
  month: string;
  purchase: number;
  sales: number;
  gross_profit: number;
}

export interface OverviewReport {
  cards: {
    purchase_total: number;
    sales_total: number;
    gross_profit: number;
    receivable_outstanding: number;
    payable_outstanding: number;
    inventory_value: number;
    inventory_kinds: number;
  };
  /** 今日/本月/累计 快速汇总 */
  buckets: {
    label: string;
    purchase: number;
    sales: number;
    gross_profit: number;
  }[];
  /** 近 12 个月 采购/销售/毛利 趋势 */
  trends: TrendPoint[];
}

export async function buildOverviewReport(): Promise<OverviewReport> {
  const supabase = getSupabaseClient();

  // 采购订单（已入库）
  const { data: poRows, error: poErr } = await supabase
    .from('po_purchase_orders')
    .select('order_date, total_amount')
    .eq('status', 'received');
  if (poErr) throwDbError(poErr, '读取采购数据');

  // 销售订单（已出库）
  const { data: soRows, error: soErr } = await supabase
    .from('so_sales_orders')
    .select('order_date, total_amount')
    .eq('status', 'shipped');
  if (soErr) throwDbError(soErr, '读取销售数据');

  // 销售退货（已核准）
  const { data: srRows, error: srErr } = await supabase
    .from('so_returns')
    .select('return_date, total_amount')
    .eq('status', 'approved');
  if (srErr) throwDbError(srErr, '读取销售退货');

  // 采购退货（已核准）
  const { data: prRows, error: prErr } = await supabase
    .from('po_returns')
    .select('return_date, total_amount')
    .eq('status', 'approved');
  if (prErr) throwDbError(prErr, '读取采购退货');

  // 出库单（成本结转）
  const { data: shRows, error: shErr } = await supabase
    .from('so_shipments')
    .select('ship_date, total_cost')
    .eq('status', 'approved');
  if (shErr) throwDbError(shErr, '读取出库成本');

  // 收付款
  const { data: payRows, error: payErr } = await supabase
    .from('fin_payments')
    .select('direction, amount, paid_at');
  if (payErr) throwDbError(payErr, '读取收付款');

  // 库存余额
  const { data: stRows, error: stErr } = await supabase
    .from('inv_stock')
    .select('quantity, avg_cost, product_id');
  if (stErr) throwDbError(stErr, '读取库存');

  const tKey = todayKey();
  const mKey = currentMonthKey();

  // 按日期聚合采购（收入口径按单据日）
  let purchaseTotal = 0;
  let todayPurchase = 0;
  let monthPurchase = 0;
  const purchaseByMonth = new Map<string, number>();
  for (const r of poRows ?? []) {
    const date = (r.order_date ?? '') as string;
    const amt = toNum(r.total_amount);
    purchaseTotal += amt;
    if (date === tKey) todayPurchase += amt;
    if (monthKey(date) === mKey) monthPurchase += amt;
    const mk = monthKey(date) || 'unknown';
    purchaseByMonth.set(mk, (purchaseByMonth.get(mk) ?? 0) + amt);
  }

  // 销售总额（订单 − 退货）与毛利（订单 − 出库成本）
  let salesTotal = 0;
  let returnTotal = 0;
  let todaySales = 0;
  let monthSales = 0;
  const salesByMonth = new Map<string, number>();
  for (const r of soRows ?? []) {
    const date = (r.order_date ?? '') as string;
    const amt = toNum(r.total_amount);
    salesTotal += amt;
    if (date === tKey) todaySales += amt;
    if (monthKey(date) === mKey) monthSales += amt;
    const mk = monthKey(date) || 'unknown';
    salesByMonth.set(mk, (salesByMonth.get(mk) ?? 0) + amt);
  }
  for (const r of srRows ?? []) {
    const date = (r.return_date ?? '') as string;
    const amt = toNum(r.total_amount);
    returnTotal += amt;
    if (date === tKey) todaySales -= amt;
    if (monthKey(date) === mKey) monthSales -= amt;
    const mk = monthKey(date) || 'unknown';
    salesByMonth.set(mk, (salesByMonth.get(mk) ?? 0) - amt);
  }
  salesTotal -= returnTotal;

  // 毛利按月（订单口径）+ 出库成本按月
  let costTotal = 0;
  const costByMonth = new Map<string, number>();
  for (const r of shRows ?? []) {
    const date = (r.ship_date ?? '') as string;
    const cost = toNum(r.total_cost);
    costTotal += cost;
    const mk = monthKey(date) || 'unknown';
    costByMonth.set(mk, (costByMonth.get(mk) ?? 0) + cost);
  }
  const grossProfit = round2(salesTotal - costTotal);

  // 应收/应付余额
  let receiptTotal = 0;
  let paymentTotal = 0;
  for (const r of payRows ?? []) {
    if (r.direction === 'receipt') receiptTotal += toNum(r.amount);
    else paymentTotal += toNum(r.amount);
  }
  let returnPurchaseTotal = 0;
  for (const r of prRows ?? []) returnPurchaseTotal += toNum(r.total_amount);

  const receivable = round2(salesTotal - receiptTotal);
  const payable = round2(purchaseTotal - returnPurchaseTotal - paymentTotal);

  // 库存总值 + 品项
  let inventoryValue = 0;
  const productSet = new Set<string>();
  for (const r of stRows ?? []) {
    inventoryValue += toNum(r.quantity) * toNum(r.avg_cost);
    productSet.add(r.product_id as string);
  }
  inventoryValue = round2(inventoryValue);

  // 近 12 月趋势（含当月）
  const months = recentMonthKeys(12);
  const trends: TrendPoint[] = months.map((mk) => {
    const purchase = round2(purchaseByMonth.get(mk) ?? 0);
    const sales = round2(salesByMonth.get(mk) ?? 0);
    const gross_profit = round2(sales - (costByMonth.get(mk) ?? 0));
    return { month: mk, purchase, sales, gross_profit };
  });

  const buckets = [
    { label: '今日', purchase: round2(todayPurchase), sales: round2(todaySales), gross_profit: round2(todaySales) },
    { label: '本月', purchase: round2(monthPurchase), sales: round2(monthSales), gross_profit: round2(monthSales) },
    { label: '累计', purchase: round2(purchaseTotal), sales: round2(salesTotal), gross_profit: grossProfit },
  ];

  return {
    cards: {
      purchase_total: round2(purchaseTotal),
      sales_total: round2(salesTotal),
      gross_profit: grossProfit,
      receivable_outstanding: receivable,
      payable_outstanding: payable,
      inventory_value: inventoryValue,
      inventory_kinds: productSet.size,
    },
    buckets,
    trends,
  };
}