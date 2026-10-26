-- ============================================================
-- 0005 财务模块（fin_*）
-- 收付款台账（一表双向：receipt 收款 / payment 付款）。
-- 应收/应付欠款不落库，由服务端聚合：
--   客户欠款 = Σ(so_sales_orders.completed total_amount) − Σ(fin_payments.receipt)
--   供应商欠款 = Σ(po_purchase_orders.completed total_amount) − Σ(fin_payments.payment)
-- ============================================================

CREATE TABLE IF NOT EXISTS fin_payments (
  id          VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no      VARCHAR(32) NOT NULL UNIQUE,   -- RCyyyymmdd-NNNN / PYyyyymmdd-NNNN
  direction   VARCHAR(16) NOT NULL,          -- receipt | payment
  customer_id VARCHAR(36) REFERENCES md_customers(id),  -- receipt 时非空
  supplier_id VARCHAR(36) REFERENCES md_suppliers(id),  -- payment 时非空
  order_id    VARCHAR(36),                   -- 关联订单（指向 so/po 两表，故不建 FK）
  order_no    VARCHAR(32),                   -- 关联单号快照
  amount      NUMERIC(14,2) NOT NULL,        -- > 0
  method      VARCHAR(32) NOT NULL DEFAULT 'bank', -- cash | bank | wechat | alipay | other
  paid_at     DATE NOT NULL,
  remark      TEXT,
  created_by  VARCHAR(36) REFERENCES sys_users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fin_payments_direction_idx  ON fin_payments (direction);
CREATE INDEX IF NOT EXISTS fin_payments_customer_idx   ON fin_payments (customer_id);
CREATE INDEX IF NOT EXISTS fin_payments_supplier_idx   ON fin_payments (supplier_id);
CREATE INDEX IF NOT EXISTS fin_payments_paid_at_idx    ON fin_payments (paid_at);
CREATE INDEX IF NOT EXISTS fin_payments_created_at_idx ON fin_payments (created_at);

ALTER TABLE fin_payments ENABLE ROW LEVEL SECURITY;
