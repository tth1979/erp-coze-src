-- 0003_sales.sql — 销售模块（so_*）：销售订单 + 明细行
-- 权威来源：src/storage/database/shared/schema.ts（经 coze-coding-ai db upgrade 同步）
-- 本文件为版本化记录，独立部署时按序执行。

-- 销售订单（单据头）
CREATE TABLE IF NOT EXISTS so_sales_orders (
  id            varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no      varchar(32) NOT NULL UNIQUE,           -- SOyyyymmdd-NNNN
  customer_id   varchar(36) NOT NULL REFERENCES md_customers(id),
  status        varchar(20) NOT NULL DEFAULT 'draft',  -- draft | confirmed | completed | cancelled
  order_date    date NOT NULL,
  total_amount  numeric(14,2) NOT NULL DEFAULT 0,
  remark        text,
  created_by    varchar(36) REFERENCES sys_users(id),
  confirmed_at  timestamptz,
  cancelled_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS so_orders_customer_idx    ON so_sales_orders (customer_id);
CREATE INDEX IF NOT EXISTS so_orders_status_idx      ON so_sales_orders (status);
CREATE INDEX IF NOT EXISTS so_orders_order_date_idx  ON so_sales_orders (order_date);
CREATE INDEX IF NOT EXISTS so_orders_created_at_idx  ON so_sales_orders (created_at);

-- 销售订单明细行（随订单级联删除）
CREATE TABLE IF NOT EXISTS so_sales_order_items (
  id          varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    varchar(36) NOT NULL REFERENCES so_sales_orders(id) ON DELETE CASCADE,
  product_id  varchar(36) NOT NULL REFERENCES md_products(id),
  quantity    numeric(12,3) NOT NULL,
  unit_price  numeric(12,2) NOT NULL,
  amount      numeric(14,2) NOT NULL,
  unit        varchar(16),                              -- 单位快照
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS so_items_order_idx    ON so_sales_order_items (order_id);
CREATE INDEX IF NOT EXISTS so_items_product_idx  ON so_sales_order_items (product_id);

-- RLS：自建会话认证，数据访问一律经由服务端 service_role（绕过 RLS）；anon 完全阻断
ALTER TABLE so_sales_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE so_sales_order_items ENABLE ROW LEVEL SECURITY;
