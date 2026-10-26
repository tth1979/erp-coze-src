-- ============================================================
-- 0007 销售 V2：SO → 出库单(SH) → 退货单(SR) 主链路
--   + 审批接入通用引擎 + 出库强校验 + 移动加权成本结转
--   + 退货红字回补 + 客户应收联动
--
-- 兼容策略：
--   - 销售订单历史状态映射：confirmed→approved / completed→shipped / cancelled→closed
--   - inv_complete_sales 由 so_fulfill_order 取代（approved→一键发货出库，
--     自动生成待审出库单并即时审核，防重复出库）
--
-- 本文件为版本化记录；开发库由 `coze-coding-ai db upgrade` 推表结构，
-- 本文件中的 UPDATE/种子/函数需在目标库执行（幂等）。
-- ============================================================

-- ------------------------------------------------------------
-- 0. 销售订单历史状态映射（幂等）
-- ------------------------------------------------------------
UPDATE so_sales_orders SET status = 'approved' WHERE status = 'confirmed';
UPDATE so_sales_orders SET status = 'shipped'  WHERE status = 'completed';
UPDATE so_sales_orders SET status = 'closed'   WHERE status = 'cancelled';

-- ------------------------------------------------------------
-- 1. 新表启用 RLS（不自建 Auth，不建 policy；服务角色直连不受限）
-- ------------------------------------------------------------
ALTER TABLE so_shipments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE so_shipment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE so_returns        ENABLE ROW LEVEL SECURITY;
ALTER TABLE so_return_items   ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 2. 审批规则种子（沿用 po_approval_rules/po_approval_rule_steps 通用表）
--    销售订单按金额四级（同采购口径）；出库单/退货单默认一级（经理终审）。
--    后置可配：改步骤表即可扩展级数与角色链。
-- ------------------------------------------------------------
-- sales_order：L1 ≤5k [manager]；L2 ≤50k [manager]；L3 ≤200k [manager,admin]；L4 >200k [manager,admin]
-- shipment / sales_return：一级 [manager]
DO $$
DECLARE
  v_doc TEXT; v_level INT; v_min NUMERIC; v_max NUMERIC; v_roles TEXT[];
  v_rule_id VARCHAR; v_step INT; v_role TEXT;
BEGIN
  FOR v_doc, v_level, v_min, v_max, v_roles IN
    SELECT * FROM (VALUES
      ('sales_order',  1, 0::NUMERIC, 5000::NUMERIC,      ARRAY['manager']::TEXT[]),
      ('sales_order',  2, 5000::NUMERIC, 50000::NUMERIC,     ARRAY['manager']::TEXT[]),
      ('sales_order',  3, 50000::NUMERIC, 200000::NUMERIC,   ARRAY['manager','admin']::TEXT[]),
      ('sales_order',  4, 200000::NUMERIC, NULL::NUMERIC,    ARRAY['manager','admin']::TEXT[]),
      ('shipment',     1, 0::NUMERIC, NULL::NUMERIC,    ARRAY['manager']::TEXT[]),
      ('sales_return', 1, 0::NUMERIC, NULL::NUMERIC,    ARRAY['manager']::TEXT[])
    ) AS t(doc_type, level, min_amount, max_amount, roles)
  LOOP
    SELECT id INTO v_rule_id FROM po_approval_rules WHERE doc_type = v_doc AND level = v_level;
    IF v_rule_id IS NULL THEN
      v_rule_id := gen_random_uuid();
      INSERT INTO po_approval_rules (id, doc_type, level, min_amount, max_amount, created_at)
      VALUES (v_rule_id, v_doc, v_level, v_min, v_max, now());
    END IF;
    v_step := 0;
    FOREACH v_role IN ARRAY v_roles LOOP
      v_step := v_step + 1;
      IF NOT EXISTS (
        SELECT 1 FROM po_approval_rule_steps
        WHERE rule_id = v_rule_id AND step_no = v_step
      ) THEN
        INSERT INTO po_approval_rule_steps (id, rule_id, step_no, approver_role, created_at)
        VALUES (gen_random_uuid(), v_rule_id, v_step, v_role, now());
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3. 出库终审：so_execute_shipment
--    待审→已审 + 数量强校验（≤订单剩余可出库量）+ 行锁扣库存（负库存 P0001）
--    + 按移动加权均价结转成本写明细 + 订单全部出库后置 shipped，单事务。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION so_execute_shipment(p_shipment_id VARCHAR, p_user_id VARCHAR)
RETURNS VOID AS $$
DECLARE
  v RECORD;
  r RECORD;
  v_qty NUMERIC(14,3); v_total NUMERIC(16,2); v_avg NUMERIC(14,4);
  v_new_qty NUMERIC(14,3); v_line_cost NUMERIC(14,2); v_total_cost NUMERIC(16,2) := 0;
  v_shipped NUMERIC(14,3);
  v_all_done BOOLEAN := true;
  l RECORD;
BEGIN
  SELECT * INTO v FROM so_shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:出库单不存在' USING ERRCODE = 'no_data_found';
  END IF;
  IF v.status <> 'pending' THEN
    RAISE EXCEPTION 'P0400:仅待审出库单可审核通过，当前状态：%', v.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 数量强校验：不得超订单剩余可出库量（订单量 − 其他已审出库单累计）
  FOR r IN SELECT product_id, quantity FROM so_shipment_items WHERE shipment_id = p_shipment_id LOOP
    SELECT COALESCE(SUM(i.quantity), 0) INTO v_shipped
    FROM so_shipment_items i
    JOIN so_shipments s ON s.id = i.shipment_id
    WHERE s.order_id = v.order_id AND s.status = 'approved' AND i.product_id = r.product_id;
    IF (SELECT COALESCE(SUM(quantity), 0) FROM so_sales_order_items
        WHERE order_id = v.order_id AND product_id = r.product_id) - v_shipped < r.quantity THEN
      RAISE EXCEPTION 'P0400:出库数量超出订单剩余可出库量（商品 %）', r.product_id
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;

  -- 逐行出库：行锁串行化，负库存拦截，按移动加权均价结转成本
  FOR r IN SELECT id, product_id, quantity FROM so_shipment_items WHERE shipment_id = p_shipment_id LOOP
    SELECT quantity, total_cost, avg_cost INTO v_qty, v_total, v_avg
    FROM inv_stock WHERE product_id = r.product_id FOR UPDATE;
    v_qty := COALESCE(v_qty, 0); v_total := COALESCE(v_total, 0); v_avg := COALESCE(v_avg, 0);
    IF v_qty - r.quantity < 0 THEN
      RAISE EXCEPTION 'P0001:库存不足，当前库存 %，本次需出库 %', v_qty, r.quantity
        USING ERRCODE = 'check_violation';
    END IF;
    v_new_qty := v_qty - r.quantity;
    v_line_cost := ROUND(r.quantity * v_avg, 2);
    v_total_cost := v_total_cost + v_line_cost;
    UPDATE inv_stock
    SET quantity = v_new_qty,
        total_cost = CASE WHEN v_new_qty = 0 THEN 0 ELSE GREATEST(v_total - v_line_cost, 0) END,
        updated_at = now()
    WHERE product_id = r.product_id;
    INSERT INTO inv_stock_movements
      (id, product_id, type, quantity, balance, source, ref_no, remark, unit_cost, created_by)
    VALUES
      (gen_random_uuid(), r.product_id, 'out', -r.quantity, v_new_qty,
       'sales_out', v.shipment_no, '销售出库', v_avg, p_user_id);
    UPDATE so_shipment_items SET cost = v_line_cost WHERE id = r.id;
  END LOOP;

  UPDATE so_shipments
  SET status = 'approved', total_cost = v_total_cost,
      approved_by = p_user_id, approved_at = now(), updated_at = now()
  WHERE id = p_shipment_id;

  -- 订单全部出库 → shipped
  FOR l IN SELECT product_id, quantity FROM so_sales_order_items WHERE order_id = v.order_id LOOP
    SELECT COALESCE(SUM(i.quantity), 0) INTO v_shipped
    FROM so_shipment_items i JOIN so_shipments s ON s.id = i.shipment_id
    WHERE s.order_id = v.order_id AND s.status = 'approved' AND i.product_id = l.product_id;
    IF v_shipped < l.quantity THEN v_all_done := false; END IF;
  END LOOP;
  IF v_all_done THEN
    UPDATE so_sales_orders SET status = 'shipped', updated_at = now() WHERE id = v.order_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 4. 退货终审：so_execute_return
--    待审→已审 + 退货量校验（≤已出库−已退）+ 按退货单快照成本红字回补
--    库存并重算移动加权，单事务。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION so_execute_return(p_return_id VARCHAR, p_user_id VARCHAR)
RETURNS VOID AS $$
DECLARE
  v RECORD;
  r RECORD;
  v_qty NUMERIC(14,3); v_total NUMERIC(16,2); v_avg NUMERIC(14,4);
  v_new_qty NUMERIC(14,3); v_new_total NUMERIC(16,2); v_new_avg NUMERIC(14,4);
  v_shipped NUMERIC(14,3); v_returned NUMERIC(14,3); v_cost NUMERIC(14,4);
BEGIN
  SELECT * INTO v FROM so_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:退货单不存在' USING ERRCODE = 'no_data_found';
  END IF;
  IF v.status <> 'pending' THEN
    RAISE EXCEPTION 'P0400:仅待审退货单可审核通过，当前状态：%', v.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 退货量校验：不得超（订单已出库量 − 已退量）
  FOR r IN SELECT product_id, quantity FROM so_return_items WHERE return_id = p_return_id LOOP
    SELECT COALESCE(SUM(i.quantity), 0) INTO v_shipped
    FROM so_shipment_items i JOIN so_shipments s ON s.id = i.shipment_id
    WHERE s.order_id = v.order_id AND s.status = 'approved' AND i.product_id = r.product_id;
    SELECT COALESCE(SUM(i.quantity), 0) INTO v_returned
    FROM so_return_items i JOIN so_returns t ON t.id = i.return_id
    WHERE t.order_id = v.order_id AND t.status = 'approved' AND i.product_id = r.product_id;
    IF v_shipped - v_returned < r.quantity THEN
      RAISE EXCEPTION 'P0400:退货数量超出已出库可退量（商品 %）', r.product_id
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END LOOP;

  -- 逐行红字回补：按退货单快照成本单价回库并重算移动加权
  FOR r IN SELECT product_id, quantity, unit_cost FROM so_return_items WHERE return_id = p_return_id LOOP
    v_cost := COALESCE(r.unit_cost, 0);
    SELECT quantity, total_cost, avg_cost INTO v_qty, v_total, v_avg
    FROM inv_stock WHERE product_id = r.product_id FOR UPDATE;
    v_qty := COALESCE(v_qty, 0); v_total := COALESCE(v_total, 0); v_avg := COALESCE(v_avg, 0);
    v_new_qty := v_qty + r.quantity;
    v_new_total := v_total + ROUND(r.quantity * v_cost, 2);
    IF v_new_qty > 0 THEN v_new_avg := ROUND(v_new_total / v_new_qty, 4); ELSE v_new_avg := v_avg; END IF;
    INSERT INTO inv_stock (id, product_id, quantity, avg_cost, total_cost, updated_at)
    VALUES (gen_random_uuid(), r.product_id, v_new_qty, v_new_avg, v_new_total, now())
    ON CONFLICT (product_id)
    DO UPDATE SET quantity = EXCLUDED.quantity, avg_cost = EXCLUDED.avg_cost,
                  total_cost = EXCLUDED.total_cost, updated_at = now();
    INSERT INTO inv_stock_movements
      (id, product_id, type, quantity, balance, source, ref_no, remark, unit_cost, created_by)
    VALUES
      (gen_random_uuid(), r.product_id, 'in', r.quantity, v_new_qty,
       'sales_return', v.return_no, '销售退货入库', v_cost, p_user_id);
  END LOOP;

  UPDATE so_returns
  SET status = 'approved', approved_by = p_user_id, approved_at = now(), updated_at = now()
  WHERE id = p_return_id;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 5. 一键发货：so_fulfill_order
--    已审订单 → 自动生成待审出库单并即时审核（等价于订单详情"发货出库"），
--    防重复出库；返回出库单号。
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION so_fulfill_order(p_order_id VARCHAR, p_user_id VARCHAR)
RETURNS VARCHAR AS $$
DECLARE
  v_status VARCHAR; v_order_no VARCHAR; v_customer VARCHAR; v_total NUMERIC(14,2);
  v_shipment_id VARCHAR := gen_random_uuid();
  v_shipment_no VARCHAR;
  v_existing INT;
BEGIN
  SELECT status, order_no, customer_id, total_amount INTO v_status, v_order_no, v_customer, v_total
  FROM so_sales_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:销售订单不存在' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'P0400:仅已审订单可发货出库，当前状态：%', v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT COUNT(*) INTO v_existing FROM so_shipments
  WHERE order_id = p_order_id AND status IN ('pending', 'approved');
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'P0400:该订单已存在出库单，禁止重复出库'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_shipment_no := 'SH' || to_char(now(), 'YYYYMMDD') || '-' || lpad((
    SELECT (COALESCE(MAX(CAST(substring(shipment_no from '-(\d+)$') AS INTEGER)), 0) + 1)::text
    FROM so_shipments WHERE shipment_no LIKE 'SH' || to_char(now(), 'YYYYMMDD') || '-%'), 4, '0');

  INSERT INTO so_shipments
    (id, shipment_no, order_id, customer_id, status, ship_date, total_amount,
     remark, created_by)
  VALUES
    (v_shipment_id, v_shipment_no, p_order_id, v_customer, 'pending', CURRENT_DATE, v_total,
     '订单发货一键出库', p_user_id);
  INSERT INTO so_shipment_items (shipment_id, product_id, quantity, unit_price, amount, unit)
  SELECT v_shipment_id, product_id, quantity, unit_price, amount, unit
  FROM so_sales_order_items WHERE order_id = p_order_id;

  PERFORM so_execute_shipment(v_shipment_id, p_user_id);
  RETURN v_shipment_no;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 6. 旧函数下线：inv_complete_sales 由 so_fulfill_order 取代
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS inv_complete_sales(VARCHAR, VARCHAR);
