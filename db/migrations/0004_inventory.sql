-- ============================================================
-- 0004 库存模块（inv_*）
-- 余额表 + 只追加流水台账；出入库与订单状态流转由数据库函数保证
-- 单事务强一致（库存不足抛异常 → 整单回滚，避免先写订单后出库失败的不一致）。
-- ============================================================

-- 库存余额（单仓库模型，每个商品一行）
CREATE TABLE IF NOT EXISTS inv_stock (
  id          VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  VARCHAR(36) NOT NULL UNIQUE REFERENCES md_products(id),
  quantity    NUMERIC(14,3) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inv_stock_quantity_idx ON inv_stock (quantity);

-- 库存流水（台账，只追加不改写）
CREATE TABLE IF NOT EXISTS inv_stock_movements (
  id          VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  VARCHAR(36) NOT NULL REFERENCES md_products(id),
  type        VARCHAR(16) NOT NULL,            -- in | out | adjust
  quantity    NUMERIC(14,3) NOT NULL,          -- 正=入库/盘盈，负=出库/盘亏
  balance     NUMERIC(14,3) NOT NULL,          -- 变动后余额快照
  source      VARCHAR(32) NOT NULL DEFAULT 'manual', -- purchase_in | sales_out | manual
  ref_no      VARCHAR(32),
  remark      TEXT,
  created_by  VARCHAR(36) REFERENCES sys_users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inv_mov_product_idx    ON inv_stock_movements (product_id);
CREATE INDEX IF NOT EXISTS inv_mov_created_at_idx ON inv_stock_movements (created_at);
CREATE INDEX IF NOT EXISTS inv_mov_type_idx       ON inv_stock_movements (type);

-- created_by 外键（db upgrade 未自动生成时幂等补建）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inv_stock_movements_created_by_fkey'
  ) THEN
    ALTER TABLE inv_stock_movements
      ADD CONSTRAINT inv_stock_movements_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES sys_users(id);
  END IF;
END $$;

ALTER TABLE inv_stock ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_stock_movements ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 通用出入库：对单个商品做一次库存变动
-- p_delta 正=入库/盘盈，负=出库/盘亏；出库不足抛 P0001 整事务回滚
-- FOR UPDATE 行锁串行化同一商品的并发变动
-- ============================================================
CREATE OR REPLACE FUNCTION inv_apply_movement(
  p_product_id VARCHAR,
  p_delta      NUMERIC,
  p_type       VARCHAR,
  p_source     VARCHAR,
  p_ref_no     VARCHAR,
  p_remark     TEXT,
  p_user_id    VARCHAR
) RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
  v_current NUMERIC(14,3) := 0;
  v_balance NUMERIC(14,3);
BEGIN
  SELECT quantity INTO v_current
  FROM inv_stock
  WHERE product_id = p_product_id
  FOR UPDATE;

  v_current := COALESCE(v_current, 0);
  IF v_current + p_delta < 0 THEN
    RAISE EXCEPTION 'P0001:库存不足，当前库存 %，本次需出库 %', v_current, -p_delta
      USING ERRCODE = 'check_violation';
  END IF;

  v_balance := v_current + p_delta;

  INSERT INTO inv_stock (id, product_id, quantity, updated_at)
  VALUES (gen_random_uuid(), p_product_id, v_balance, now())
  ON CONFLICT (product_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now();

  INSERT INTO inv_stock_movements
    (id, product_id, type, quantity, balance, source, ref_no, remark, created_by)
  VALUES
    (gen_random_uuid(), p_product_id, p_type, p_delta, v_balance,
     p_source, p_ref_no, p_remark, p_user_id);

  RETURN v_balance;
END;
$$;

-- ============================================================
-- 采购到货：confirmed → completed，按订单明细整单入库
-- 任一商品入库失败（理论上入库不会负库存）→ 整事务回滚，订单状态不变
-- ============================================================
CREATE OR REPLACE FUNCTION inv_complete_purchase(p_order_id VARCHAR, p_user_id VARCHAR)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_status VARCHAR;
  v_order_no VARCHAR;
  r RECORD;
BEGIN
  SELECT status, order_no INTO v_status, v_order_no
  FROM po_purchase_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:采购订单不存在' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'confirmed' THEN
    RAISE EXCEPTION 'P0400:仅已确认订单可以到货入库，当前状态：%', v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR r IN
    SELECT product_id, quantity
    FROM po_purchase_order_items
    WHERE order_id = p_order_id
  LOOP
    PERFORM inv_apply_movement(
      r.product_id, r.quantity, 'in', 'purchase_in', v_order_no,
      '采购到货入库', p_user_id
    );
  END LOOP;

  UPDATE po_purchase_orders
  SET status = 'completed', updated_at = now()
  WHERE id = p_order_id;
END;
$$;

-- ============================================================
-- 销售发货：confirmed → completed，按订单明细整单出库
-- 库存不足（P0001）→ 整事务回滚：不写流水、订单仍为 confirmed
-- ============================================================
CREATE OR REPLACE FUNCTION inv_complete_sales(p_order_id VARCHAR, p_user_id VARCHAR)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_status VARCHAR;
  v_order_no VARCHAR;
  r RECORD;
BEGIN
  SELECT status, order_no INTO v_status, v_order_no
  FROM so_sales_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:销售订单不存在' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'confirmed' THEN
    RAISE EXCEPTION 'P0400:仅已确认订单可以发货出库，当前状态：%', v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR r IN
    SELECT product_id, quantity
    FROM so_sales_order_items
    WHERE order_id = p_order_id
  LOOP
    PERFORM inv_apply_movement(
      r.product_id, -r.quantity, 'out', 'sales_out', v_order_no,
      '销售发货出库', p_user_id
    );
  END LOOP;

  UPDATE so_sales_orders
  SET status = 'completed', updated_at = now()
  WHERE id = p_order_id;
END;
$$;
