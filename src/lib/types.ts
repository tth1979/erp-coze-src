/** 与服务端 / 数据库列保持 snake_case 一致 */
export interface SessionUser {
  id: string;
  username: string;
  display_name: string;
  role: string;
  status: string;
}

export interface PagedList<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface Customer {
  id: string;
  code: string;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  level: string;
  tax_no: string | null;
  status: string;
  remark: string | null;
  /** 信用额度（0=不启用信用管控） */
  credit_limit?: number;
  /** 信用账期（天，0=不计算逾期） */
  credit_days?: number;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// 销售闭环（0023）：价格策略 / 报价单 / 客户信用
// ---------------------------------------------------------------------------

export interface PriceStrategy {
  id: string;
  scope_type: 'customer_sku' | 'customer_level' | 'global';
  customer_id: string | null;
  customer_name: string | null;
  customer_level: string | null;
  product_id: string | null;
  product_name: string | null;
  product_sku: string | null;
  effective_from: string;
  effective_to: string | null;
  status: string;
  remark: string | null;
  created_by_name: string | null;
  created_at: string;
  tiers: Array<{ unit: string; min_qty: number; unit_price: number }>;
}

export interface PriceResolveResult {
  hit: boolean;
  unit_price: number;
  strategy_id: string | null;
  scope_type: 'customer_sku' | 'customer_level' | 'global' | null;
  tier: { unit: string; min_qty: number; unit_price: number } | null;
  reason: string;
}

export interface QuoteItem {
  id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  product_spec: string | null;
  color_code: string;
  color_name: string | null;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount_rate: number;
  amount: number;
  tax_rate: number;
}

export interface Quote {
  id: string;
  quote_no: string;
  customer_id: string;
  customer_name: string | null;
  customer_level: string | null;
  quote_date: string;
  valid_until: string | null;
  salesman: string | null;
  status: string;
  total_amount: number;
  remark: string | null;
  converted_order_id: string | null;
  converted_order_no: string | null;
  converted_at: string | null;
  void_reason: string | null;
  created_by_name: string | null;
  item_count: number;
  created_at: string;
  items?: QuoteItem[];
}

export interface CreditBoardRow {
  customer_id: string;
  code: string;
  name: string;
  level: string | null;
  credit_limit: number;
  credit_days: number;
  enabled: boolean;
  ar_outstanding: number;
  order_hold: number;
  used: number;
  available: number;
  usage_rate: number | null;
  overdue_amount: number;
  overdue_max_days: number;
  status: 'green' | 'yellow' | 'red';
}

export interface CreditBill {
  bill_no: string;
  order_id: string;
  bill_date: string;
  amount: number;
  settled: number;
  outstanding: number;
  due_date: string | null;
  overdue_days: number;
}

export interface CreditDetail {
  summary: {
    customer_id: string;
    credit_limit: number;
    credit_days: number;
    ar_outstanding: number;
    order_hold: number;
    used: number;
    available: number;
    enabled: boolean;
  };
  bills: CreditBill[];
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  tax_no: string | null;
  settlement: string | null;
  status: string;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  sku_code: string;
  name: string;
  model: string | null;
  spec: string | null;
  unit: string;
  barcode: string | null;
  category: string | null;
  brand: string | null;
  color: string | null;
  pieces_per_box: number | null;
  area_per_box: string | null;
  reference_purchase_price: string | null;
  reference_sale_price: string | null;
  /** 安全库存阈值（库存预警用） */
  safety_stock: string | null;
  /** 税率（%），凭证/税务引擎据此计税额 */
  tax_rate: string | null;
  status: string;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

export interface OverviewStats {
  customers: number;
  suppliers: number;
  products: number;
  purchase_orders?: {
    total: number;
    draft: number;
    pending: number;
    approved: number;
    received: number;
  };
  sales_orders?: {
    total: number;
    draft: number;
    pending: number;
    approved: number;
    shipped: number;
  };
  inventory?: {
    tracked_kinds: number;
    out_of_stock: number;
    /** 命中安全库存预警的品项数 */
    alerts: number;
  };
  finance?: {
    receivable_outstanding: number;
    payable_outstanding: number;
  };
}

// ---------------------------------------------------------------------------
// 采购模块
// ---------------------------------------------------------------------------

export interface PurchaseOrderItem {
  id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  product_spec: string | null;
  color_code: string | null;
  color_name: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  unit: string | null;
}

export interface PurchaseOrder {
  id: string;
  order_no: string;
  supplier_id: string;
  supplier_name: string | null;
  /** draft 草稿 | pending 待审 | approved 已审 | rejected 已驳回 | received 已入库 | closed 已关闭 */
  status: string;
  order_date: string;
  total_amount: number;
  item_count: number;
  remark: string | null;
  created_by_name: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  /** 来源申请单（采购 V2） */
  requisition_id: string | null;
  requisition_no?: string | null;
  approval_level: number | null;
  current_step: number;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  reject_reason: string | null;
  /** 收货/发货仓库（空=默认仓） */
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  items?: PurchaseOrderItem[];
  steps?: ApprovalStep[];
}

/** 审批步骤实例（采购四单通用） */
export interface ApprovalStep {
  step_no: number;
  approver_role: string;
  approver_role_label: string;
  status: 'pending' | 'approved' | 'rejected';
  approver_name: string | null;
  comment: string | null;
  acted_at: string | null;
}

/** 采购申请单 */
export interface PoRequisition {
  id: string;
  req_no: string;
  status: string;
  reason: string | null;
  total_estimate: number;
  item_count: number;
  approval_level: number | null;
  current_step: number;
  reject_reason: string | null;
  converted_order_id: string | null;
  converted_order_no?: string | null;
  remark: string | null;
  created_by_name: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  created_at: string;
  items?: Array<{
    id: string;
    product_id: string;
    product_name: string | null;
    product_sku: string | null;
    color_code: string | null;
    color_name: string | null;
    quantity: number;
    suggest_price: number;
    amount: number;
    unit: string | null;
  }>;
  steps?: ApprovalStep[];
}

/** 采购入库单（reversal_kind: red 红字冲回 | blue 蓝字重入） */
export interface PoReceipt {
  id: string;
  receipt_no: string;
  order_id: string;
  order_no: string | null;
  supplier_id: string;
  supplier_name: string | null;
  status: string;
  is_estimated: boolean;
  invoice_no: string | null;
  reversal_of_id: string | null;
  reversal_kind: 'red' | 'blue' | null;
  total_amount: number;
  receive_date: string;
  item_count: number;
  approval_level: number | null;
  current_step: number;
  reject_reason: string | null;
  remark: string | null;
  created_by_name: string | null;
  created_at: string;
  items?: Array<{
    id: string;
    product_id: string;
    product_name: string | null;
    product_sku: string | null;
    color_code: string | null;
    color_name: string | null;
    quantity: number;
    unit_price: number;
    amount: number;
    unit: string | null;
  }>;
  steps?: ApprovalStep[];
}

/** 采购退货单 */
export interface PoReturn {
  id: string;
  return_no: string;
  order_id: string | null;
  order_no: string | null;
  receipt_id: string | null;
  receipt_no: string | null;
  supplier_id: string;
  supplier_name: string | null;
  status: string;
  reason: string | null;
  total_amount: number;
  return_date: string;
  item_count: number;
  approval_level: number | null;
  current_step: number;
  reject_reason: string | null;
  remark: string | null;
  created_by_name: string | null;
  created_at: string;
  items?: Array<{
    id: string;
    product_id: string;
    product_name: string | null;
    product_sku: string | null;
    color_code: string | null;
    color_name: string | null;
    quantity: number;
    unit_price: number;
    amount: number;
    unit: string | null;
  }>;
  steps?: ApprovalStep[];
}

// ---------------------------------------------------------------------------
// 销售模块
// ---------------------------------------------------------------------------

export interface SalesOrderItem {
  id: string;
  product_id: string;
  product_name: string | null;
  product_sku: string | null;
  product_spec: string | null;
  color_code: string | null;
  color_name: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
  unit: string | null;
}

export interface SalesOrder {
  id: string;
  order_no: string;
  customer_id: string;
  customer_name: string | null;
  /** 客户等级快照：normal | vip | strategic */
  customer_level: string | null;
  /** draft | pending | approved | rejected | shipped | closed */
  status: string;
  order_date: string;
  total_amount: number;
  item_count: number;
  remark: string | null;
  created_by_name: string | null;
  approval_level: number | null;
  current_step: number;
  submitted_at: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  /** 发货仓库（空=默认仓） */
  warehouse_id?: string | null;
  warehouse_name?: string | null;
  items?: SalesOrderItem[];
  steps?: ApprovalStep[];
}

/** 销售出库单（SH；approved 即已出库，明细 cost 为结转成本） */
export interface SoShipment {
  id: string;
  shipment_no: string;
  order_id: string;
  order_no: string | null;
  customer_id: string;
  customer_name: string | null;
  status: string;
  ship_date: string;
  total_amount: number;
  total_cost: number;
  approval_level: number | null;
  current_step: number;
  submitted_at: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  remark: string | null;
  created_by_name: string | null;
  created_at: string;
  items?: Array<{
    id: string;
    product_id: string;
    product_name: string | null;
    product_sku: string | null;
    color_code: string | null;
    color_name: string | null;
    quantity: number;
    unit_price: number;
    amount: number;
    cost: number | null;
    unit: string | null;
  }>;
  steps?: ApprovalStep[];
}

/** 销售退货单（SR；approved 即已红字回补库存） */
export interface SoReturn {
  id: string;
  return_no: string;
  order_id: string;
  order_no: string | null;
  shipment_id: string | null;
  shipment_no: string | null;
  customer_id: string;
  customer_name: string | null;
  status: string;
  return_date: string;
  reason: string | null;
  total_amount: number;
  approval_level: number | null;
  current_step: number;
  submitted_at: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  remark: string | null;
  created_by_name: string | null;
  created_at: string;
  items?: Array<{
    id: string;
    product_id: string;
    product_name: string | null;
    product_sku: string | null;
    color_code: string | null;
    color_name: string | null;
    quantity: number;
    unit_price: number;
    amount: number;
    unit_cost: number | null;
    unit: string | null;
  }>;
  steps?: ApprovalStep[];
}

/** 销售报价建议（客户等级折扣 × 商品参考售价） */
export interface QuoteResult {
  customer_id: string;
  product_id: string;
  customer_level: string;
  base_price: number;
  discount: number;
  price: number;
}

// ---------------------------------------------------------------------------
// 购销通用（采购/销售共用编辑器与组件）
// ---------------------------------------------------------------------------

export type TradeOrder = PurchaseOrder | SalesOrder;
export type TradeOrderItem = PurchaseOrderItem | SalesOrderItem;

// ---------------------------------------------------------------------------
// 库存模块
// ---------------------------------------------------------------------------

export interface StockItem {
  product_id: string;
  product_name: string;
  sku_code: string | null;
  spec: string | null;
  unit: string | null;
  /** 色号（''/null = 默认色） */
  color_code: string | null;
  color_name: string | null;
  /** 所属仓库 */
  warehouse_id: string;
  warehouse_name: string | null;
  /** 现有量（实物在库） */
  quantity: number;
  /** 在途量（调拨调出未收货） */
  in_transit: number;
  /** 冻结量（不可用） */
  frozen_quantity: number;
  /** 可用量 = 现有 − 冻结 */
  available: number;
  /** 移动加权平均成本 */
  avg_cost: number;
  /** 库存货值 */
  total_cost: number;
  updated_at: string;
}

/** in 入库 | out 出库 | adjust 盘盈/盘亏 */
export interface StockMovement {
  id: string;
  product_id: string;
  product_name: string;
  sku_code: string | null;
  unit: string | null;
  /** 色号（''/null = 默认色） */
  color_code: string | null;
  /** 发生仓库 */
  warehouse_id: string | null;
  warehouse_name: string | null;
  /** 关联批次（入库产生/出库 FIFO 消耗） */
  batch_id: string | null;
  batch_no: string | null;
  type: string;
  quantity: number;
  balance: number;
  /** purchase_in | sales_out | purchase_return | receipt_reversal | transfer_out | transfer_in | check_in | check_out | manual */
  source: string;
  ref_no: string | null;
  remark: string | null;
  /** 本次单价/成本快照（入库=单价，出库=加权均价） */
  unit_cost: number | null;
  created_by_name: string | null;
  created_at: string;
}

/** 仓库 */
export interface InvWarehouse {
  id: string;
  code: string;
  name: string;
  address: string | null;
  is_active: boolean;
  created_at: string;
}

/** 库存批次（批号 = 来源入库单号） */
export interface InvBatch {
  id: string;
  product_id: string;
  product_name: string;
  sku_code: string | null;
  unit: string | null;
  color_code: string | null;
  color_name: string | null;
  warehouse_id: string;
  warehouse_name: string | null;
  batch_no: string;
  /** 入库单价（成本口径） */
  unit_cost: number;
  initial_quantity: number;
  remaining_quantity: number;
  production_date: string | null;
  expiry_date: string | null;
  source_ref: string | null;
  created_at: string;
}

/** 库存预警条目（按 商品×色号 跨仓可用合计 ≤ 安全库存） */
export interface InvAlert {
  product_id: string;
  product_name: string;
  sku_code: string | null;
  spec: string | null;
  unit: string | null;
  color_code: string | null;
  color_name: string | null;
  safety_stock: number;
  total_quantity: number;
  total_available: number;
  total_in_transit: number;
}

/** 库存调拨单（IT） */
export interface InvTransfer {
  id: string;
  transfer_no: string;
  from_warehouse_id: string;
  from_warehouse_name: string | null;
  to_warehouse_id: string;
  to_warehouse_name: string | null;
  status: string;
  remark: string | null;
  approval_level: number | null;
  current_step: number | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  received_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  items?: InvTransferItem[];
  steps?: ApprovalStep[];
}

export interface InvTransferItem {
  id: string;
  product_id: string;
  product_name: string;
  sku_code: string | null;
  unit: string | null;
  color_code: string | null;
  color_name: string | null;
  quantity: number;
  /** 调出时移动加权成本快照 */
  unit_cost: number | null;
  remark: string | null;
}

/** 库存盘点单（IC） */
export interface InvCheck {
  id: string;
  check_no: string;
  warehouse_id: string;
  warehouse_name: string | null;
  status: string;
  remark: string | null;
  approval_level: number | null;
  current_step: number | null;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  items?: InvCheckItem[];
  steps?: ApprovalStep[];
}

export interface InvCheckItem {
  id: string;
  product_id: string;
  product_name: string;
  sku_code: string | null;
  unit: string | null;
  color_code: string | null;
  color_name: string | null;
  /** 账面数量（建单快照） */
  book_quantity: number;
  /** 实盘数量 */
  counted_quantity: number;
  /** 差异 = 实盘 − 账面（终审过账后写入） */
  difference: number | null;
  /** 差异过账成本口径快照 */
  unit_cost: number | null;
  remark: string | null;
}

// ---------------------------------------------------------------------------
// 财务模块
// ---------------------------------------------------------------------------

/** 收付款单（receipt 收款 | payment 付款） */
export interface FinPayment {
  id: string;
  doc_no: string;
  direction: 'receipt' | 'payment';
  customer_id: string | null;
  customer_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  order_id: string | null;
  order_no: string | null;
  amount: number;
  /** cash | bank | wechat | alipay | other */
  method: string;
  paid_at: string;
  /** pending(待核销) | approved(已核销) | cancelled(作废) */
  status: string;
  bill_no: string | null;
  approved_at: string | null;
  remark: string | null;
  created_by_name: string | null;
  created_at: string;
}

/** 应收/应付单行（物化：已出库销售订单 / 已入库采购订单） */
export interface FinBillRow {
  bill_no: string;
  order_id: string;
  partner_id: string;
  partner_name: string;
  bill_date: string;
  amount: number;
  settled: number;
  outstanding: number;
  status: 'open' | 'settled';
}

/** 应收欠款聚合行（按客户） */
export interface ReceivableRow {
  customer_id: string;
  code: string;
  name: string;
  contact: string | null;
  phone: string | null;
  billed: number;
  received: number;
  outstanding: number;
}

/** 应付欠款聚合行（按供应商） */
export interface PayableRow {
  supplier_id: string;
  code: string;
  name: string;
  contact: string | null;
  phone: string | null;
  billed: number;
  paid: number;
  outstanding: number;
}

// ============================================================
// 经营统计报表（report_*）
// ============================================================

export interface TrendPoint {
  month: string;
  purchase: number;
  sales: number;
  gross_profit: number;
}

export interface ReportOverview {
  cards: {
    purchase_total: number;
    sales_total: number;
    gross_profit: number;
    receivable_outstanding: number;
    payable_outstanding: number;
    inventory_value: number;
    inventory_kinds: number;
  };
  buckets: Array<{ label: string; purchase: number; sales: number; gross_profit: number }>;
  trends: TrendPoint[];
}

export interface ReportRow {
  key: string;
  name: string;
  amount: number;
  order_count?: number;
}

// ============================================================
// 系统数据字典（dict_*）+ 计量单位（md_units）
// ============================================================

export interface DictTypeView {
  id: string;
  type_code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  sort: number;
}

export interface DictItemView {
  id: string;
  type_code: string;
  item_code: string;
  label: string;
  extra: Record<string, unknown> | null;
  sort: number;
  is_active: boolean;
}

export interface MdUnit {
  id: string;
  unit_code: string;
  unit_name: string;
  base_unit: string;
  conversion_ratio: string;
  remark: string | null;
  is_active: boolean;
}

// ===== 加工管理（ma_*）=====
export type MaItemKind = 'input' | 'output';

export interface MaItem {
  id: string;
  mo_id: string;
  line_no: number;
  kind: MaItemKind;
  product_id: string;
  product_name: string;
  sku_code: string;
  unit_name: string;
  quantity: number;
  done_quantity: number;
  unit_cost: number;
  warehouse_id: string | null;
}

export interface MaOrder {
  id: string;
  doc_no: string;
  processing_type: string;
  loss_ratio: number;
  status: string;
  estimate_cost: number;
  issued_cost: number;
  allocated_cost: number;
  remark: string | null;
  approval_level: number;
  current_step: number;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  creator_name: string | null;
  input_count: number;
  output_count: number;
  steps: ApprovalStep[];
}

export interface MaOrderDetail {
  order: MaOrder;
  items: MaItem[];
}

export interface MaEditableItem {
  kind: MaItemKind;
  product_id: string;
  quantity: number;
}
