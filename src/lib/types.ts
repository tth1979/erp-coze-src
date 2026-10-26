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
  created_at: string;
  updated_at: string;
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
    confirmed: number;
  };
  inventory?: {
    tracked_kinds: number;
    out_of_stock: number;
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
  /** draft | confirmed | completed | cancelled */
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
  items?: SalesOrderItem[];
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
  quantity: number;
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
  type: string;
  quantity: number;
  balance: number;
  /** purchase_in | sales_out | purchase_return | receipt_reversal | manual */
  source: string;
  ref_no: string | null;
  remark: string | null;
  /** 本次单价/成本快照（入库=单价，出库=加权均价） */
  unit_cost: number | null;
  created_by_name: string | null;
  created_at: string;
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
  remark: string | null;
  created_by_name: string | null;
  created_at: string;
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
