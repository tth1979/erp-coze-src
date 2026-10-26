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
    confirmed: number;
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
  items?: PurchaseOrderItem[];
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
  /** purchase_in | sales_out | manual */
  source: string;
  ref_no: string | null;
  remark: string | null;
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
