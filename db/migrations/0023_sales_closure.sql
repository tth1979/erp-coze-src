-- 0023_sales_closure.sql
-- 销售闭环补全：价格体系（策略+阶梯）/ 报价单 / 客户信用（幂等、RLS，不改既有迁移）

-- ============================================================
-- 1) 价格策略表 so_price_strategies（作用对象三档 + 生效起止日）
-- ============================================================
CREATE TABLE IF NOT EXISTS so_price_strategies (
  id              varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
  /** 作用对象：customer_sku=客户+SKU 专属 / customer_level=客户等级 / global=全局默认 */
  scope_type      varchar(20)  NOT NULL,
  /** scope_type=customer_sku 时必填 */
  customer_id     varchar(36)  REFERENCES md_customers(id),
  /** scope_type=customer_sku 时必填 */
  product_id      varchar(36)  REFERENCES md_products(id),
  /** scope_type=customer_level 时必填（normal/vip/strategic） */
  customer_level  varchar(32),
  effective_from  date         NOT NULL,
  /** 空 = 长期有效 */
  effective_to    date,
  status          varchar(16)  NOT NULL DEFAULT 'active',   -- active / disabled
  remark          text,
  created_by      varchar(36),
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chk_price_strategy_scope CHECK (
    (scope_type = 'customer_sku'   AND customer_id IS NOT NULL AND product_id IS NOT NULL AND customer_level IS NULL) OR
    (scope_type = 'customer_level' AND customer_level IS NOT NULL AND customer_id IS NULL AND product_id IS NULL) OR
    (scope_type = 'global'         AND customer_id IS NULL AND product_id IS NULL AND customer_level IS NULL)
  ),
  CONSTRAINT chk_price_strategy_dates CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX IF NOT EXISTS idx_price_strategies_scope   ON so_price_strategies (scope_type, status);
CREATE INDEX IF NOT EXISTS idx_price_strategies_cust    ON so_price_strategies (customer_id)   WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_price_strategies_prod    ON so_price_strategies (product_id)    WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_price_strategies_level   ON so_price_strategies (customer_level) WHERE customer_level IS NOT NULL;
ALTER TABLE so_price_strategies ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2) 价格阶梯明细 so_price_tiers（min_qty → unit_price，支持按单位分套）
-- ============================================================
CREATE TABLE IF NOT EXISTS so_price_tiers (
  id              varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
  strategy_id     varchar(36)  NOT NULL REFERENCES so_price_strategies(id) ON DELETE CASCADE,
  /** 计价单位（片/箱/㎡），与商品单位一致直接取价 */
  unit            varchar(16)  NOT NULL DEFAULT '片',
  /** 满足该档的最小数量（含） */
  min_qty         numeric(12,3) NOT NULL,
  /** 含税单价 */
  unit_price      numeric(12,2) NOT NULL,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chk_price_tier_qty   CHECK (min_qty > 0),
  CONSTRAINT chk_price_tier_price CHECK (unit_price >= 0)
);
CREATE INDEX IF NOT EXISTS idx_price_tiers_strategy ON so_price_tiers (strategy_id, unit, min_qty);
ALTER TABLE so_price_tiers ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3) 报价单头 so_quotes
-- ============================================================
CREATE TABLE IF NOT EXISTS so_quotes (
  id              varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
  /** 报价单号：QOyyyymmdd-NNNN（业务唯一） */
  quote_no        varchar(32)  NOT NULL UNIQUE,
  customer_id     varchar(36)  NOT NULL REFERENCES md_customers(id),
  quote_date      date         NOT NULL,
  /** 有效期至（逾期仅提示，不强制状态翻转） */
  valid_until     date,
  /** 业务员（冗余快照 username） */
  salesman        varchar(64),
  /** 状态机：draft → sent → accepted → converted；任意非终态 → void；valid_until 过期人工标记 expired */
  status          varchar(16)  NOT NULL DEFAULT 'draft',
  total_amount    numeric(14,2) NOT NULL DEFAULT 0,
  remark          text,
  /** 转销售订单后回写 */
  converted_order_id varchar(36) REFERENCES so_sales_orders(id),
  converted_at    timestamptz,
  sent_at         timestamptz,
  accepted_at     timestamptz,
  void_reason     text,
  created_by      varchar(36),
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_so_quotes_customer ON so_quotes (customer_id);
CREATE INDEX IF NOT EXISTS idx_so_quotes_status   ON so_quotes (status);
CREATE INDEX IF NOT EXISTS idx_so_quotes_date     ON so_quotes (quote_date DESC);
ALTER TABLE so_quotes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 4) 报价单明细 so_quote_items
-- ============================================================
CREATE TABLE IF NOT EXISTS so_quote_items (
  id              varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
  quote_id        varchar(36)  NOT NULL REFERENCES so_quotes(id) ON DELETE CASCADE,
  product_id      varchar(36)  NOT NULL REFERENCES md_products(id),
  /** 色号（0022 口径：''=默认色） */
  color_code      varchar(32)  NOT NULL DEFAULT '',
  color_name      varchar(64),
  quantity        numeric(12,3) NOT NULL,
  /** 单位快照 */
  unit            varchar(16),
  /** 含税单价 */
  unit_price      numeric(12,2) NOT NULL,
  /** 折扣率 0-100（100=无折扣） */
  discount_rate   numeric(6,2)  NOT NULL DEFAULT 100,
  /** 行金额 = quantity × unit_price × discount_rate/100（服务端计算） */
  amount          numeric(14,2) NOT NULL,
  /** 税率（%）快照 */
  tax_rate        numeric(5,2)  NOT NULL DEFAULT 13,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT chk_quote_item_qty   CHECK (quantity > 0),
  CONSTRAINT chk_quote_item_price CHECK (unit_price >= 0),
  CONSTRAINT chk_quote_item_disc  CHECK (discount_rate > 0 AND discount_rate <= 100)
);
CREATE INDEX IF NOT EXISTS idx_so_quote_items_quote   ON so_quote_items (quote_id);
CREATE INDEX IF NOT EXISTS idx_so_quote_items_product ON so_quote_items (product_id);
ALTER TABLE so_quote_items ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5) 客户信用列（md_customers 加列，幂等）
-- ============================================================
ALTER TABLE md_customers ADD COLUMN IF NOT EXISTS credit_limit numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE md_customers ADD COLUMN IF NOT EXISTS credit_days  integer       NOT NULL DEFAULT 0;
COMMENT ON COLUMN md_customers.credit_limit IS '信用额度（0=不启用信用管控）';
COMMENT ON COLUMN md_customers.credit_days  IS '信用账期天数（0=不启用逾期判定）';

-- 销售订单回写报价来源（报价转订单）
ALTER TABLE so_sales_orders ADD COLUMN IF NOT EXISTS quote_id varchar(36) REFERENCES so_quotes(id);
CREATE INDEX IF NOT EXISTS idx_so_orders_quote ON so_sales_orders (quote_id) WHERE quote_id IS NOT NULL;

-- ============================================================
-- 6) 信用强制通过留痕（落 sys_audit_logs，无需新表；此处仅注释说明）
--    action=credit.override，resource=so_order / so_quote
-- ============================================================
