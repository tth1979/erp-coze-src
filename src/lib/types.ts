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
}
