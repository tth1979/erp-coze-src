-- ============================================================
-- 0006 采购 V2：五单主链路（申请→订单→入库→退货→暂估冲回）
--   + 四级审批流（规则表可配）+ 移动加权成本雏形 + 供应商往来联动
--
-- 兼容策略：
--   - 采购订单历史状态映射：confirmed→approved / completed→received / cancelled→closed
--   - inv_complete_purchase 由 po_fulfill_order 取代（approved→received 一键到货入库）
--   - 销售模块状态机与 inv_complete_sales 保持不动
--
-- 本文件为版本化记录；开发库由 `coze-coding-ai db upgrade` 推表结构，
-- 本文件中的 UPDATE/种子/函数需在目标库执行（幂等）。
-- ============================================================

-- ------------------------------------------------------------
-- 0. 采购订单历史状态映射（幂等）
-- ------------------------------------------------------------
UPDATE po_purchase_orders SET status = 'approved' WHERE status = 'confirmed';
UPDATE po_purchase_orders SET status = 'received' WHERE status = 'completed';
UPDATE po_purchase_orders SET status = 'closed'   WHERE status = 'cancelled';

-- ------------------------------------------------------------
-- 1. 新表启用 RLS（不自建 Auth，不建 policy；服务角色直连不受限）
-- ------------------------------------------------------------
ALTER TABLE po_approval_rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_approval_rule_steps  ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_approval_steps       ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_requisitions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_requisition_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_receipts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_receipt_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_returns              ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_return_items         ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 2. 默认审批规则种子（四级；后置可配：改步骤表即可扩展级数与角色链）
--    申请单/采购订单按金额分四级；入库/退货默认一级（经理终审）。
-- ------------------------------------------------------------
-- requisition / order：L1 ≤5k [manager]；L2 ≤50k [manager]；L3 ≤200k [manager,admin]；L4 >200k [manager,admin]
DO $$
DECLARE
  v_doc TEXT; v_level INT; v_min NUMERIC; v_max NUMERIC; v_roles TEXT[];
  v_rule_id VARCHAR; v_step INT; v_role TEXT;
BEGIN
  FOR v_doc, v_level, v_min, v_max, v_roles IN
    SELECT * FROM (VALUES
      ('requisition', 1, 0::NUMERIC, 5000::NUMERIC,    ARRAY['manager']::TEXT[]),
      ('requisition', 2, 5000::NUMERIC, 50000::NUMERIC,   ARRAY['manager']::TEXT[]),
      ('requisition', 3, 50000::NUMERIC, 200000::NUMERIC,  ARRAY['manager','admin']::TEXT[]),
      ('requisition', 4, 200000::NUMERIC, NULL::NUMERIC,  ARRAY['manager','admin']::TEXT[]),
      ('order',       1, 0::NUMERIC, 5000::NUMERIC,    ARRAY['manager']::TEXT[]),
      ('order',       2, 5000::NUMERIC, 50000::NUMERIC,   ARRAY['manager']::TEXT[]),
      ('order',       3, 50000::NUMERIC, 200000::NUMERIC,  ARRAY['manager','admin']::TEXT[]),
      ('order',       4, 200000::NUMERIC, NULL::NUMERIC,  ARRAY['manager','admin']::TEXT[]),
      ('receipt',     1, 0::NUMERIC, NULL::NUMERIC,  ARRAY['manager']::TEXT[]),
      ('return',      1, 0::NUMERIC, NULL::NUMERIC,  ARRAY['manager']::TEXT[])
    ) AS t(doc_type, level, min_amount, max_amount, roles)
  LOOP
    SELECT id INTO v_rule_id FROM po_approval_rules WHERE doc_type = v_doc AND level = v_level;
    IF v_rule_id IS NULL THEN
      v_rule_id := gen_random_uuid();
      INSERT INTO po_approval_rules (id, doc_type, level, min_amount, max_amount)
      VALUES (v_rule_id, v_doc, v_level, v_min, v_max);
    END IF;
    v_step := 0;
    FOREACH v_role IN ARRAY v_roles LOOP
      v_step := v_step + 1;
      INSERT INTO po_approval_rule_steps (rule_id, step_no, approver_role)
      SELECT v_rule_id, v_step, v_role
      WHERE NOT EXISTS (
        SELECT 1 FROM po_approval_rule_steps WHERE rule_id = v_rule_id AND step_no = v_step
      );
    END LOOP;
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 3. 库存成本函数（移动加权）
-- ------------------------------------------------------------

-- 采购入库：余额 + 移动加权成本重算 + 流水（带入库价快照）
CREATE OR REPLACE FUNCTION inv_apply_receipt_in(
  p_product_id VARCHAR, p_quantity NUMERIC, p_unit_cost NUMERIC,
  p_ref_no VARCHAR, p_remark TEXT, p_user_id VARCHAR
) RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
  v_qty   NUMERIC(14,3);
  v_total NUMERIC(16,2);
  v_avg   NUMERIC(14,4);
  v_new_qty   NUMERIC(14,3);
  v_new_total NUMERIC(16,2);
  v_new_avg   NUMERIC(14,4);
BEGIN
  SELECT quantity, total_cost, avg_cost INTO v_qty, v_total, v_avg
  FROM inv_stock WHERE product_id = p_product_id FOR UPDATE;
  v_qty := COALESCE(v_qty, 0); v_total := COALESCE(v_total, 0); v_avg := COALESCE(v_avg, 0);

  v_new_qty   := v_qty + p_quantity;
  v_new_total := v_total + ROUND(p_quantity * p_unit_cost, 2);
  -- 移动加权：新均价 = 新货值 / 新数量（数量为 0 时保留原均价，仅为兜底）
  IF v_new_qty > 0 THEN v_new_avg := ROUND(v_new_total / v_new_qty, 4); ELSE v_new_avg := v_avg; END IF;

  INSERT INTO inv_stock (id, product_id, quantity, avg_cost, total_cost, updated_at)
  VALUES (gen_random_uuid(), p_product_id, v_new_qty, v_new_avg, v_new_total, now())
  ON CONFLICT (product_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, avg_cost = EXCLUDED.avg_cost,
                total_cost = EXCLUDED.total_cost, updated_at = now();

  INSERT INTO inv_stock_movements
    (id, product_id, type, quantity, balance, source, ref_no, remark, unit_cost, created_by)
  VALUES
    (gen_random_uuid(), p_product_id, 'in', p_quantity, v_new_qty,
     'purchase_in', p_ref_no, p_remark, p_unit_cost, p_user_id);
  RETURN v_new_qty;
END;
$$;

-- 出库（采购退货 / 暂估红字冲回）：按当前移动加权成本扣减货值；库存不足整事务回滚
CREATE OR REPLACE FUNCTION inv_apply_issue_out(
  p_product_id VARCHAR, p_quantity NUMERIC, p_source VARCHAR,
  p_ref_no VARCHAR, p_remark TEXT, p_user_id VARCHAR
) RETURNS NUMERIC
LANGUAGE plpgsql AS $$
DECLARE
  v_qty   NUMERIC(14,3);
  v_total NUMERIC(16,2);
  v_avg   NUMERIC(14,4);
  v_new_qty   NUMERIC(14,3);
  v_out_cost  NUMERIC(16,2);
  v_new_total NUMERIC(16,2);
BEGIN
  SELECT quantity, total_cost, avg_cost INTO v_qty, v_total, v_avg
  FROM inv_stock WHERE product_id = p_product_id FOR UPDATE;
  v_qty := COALESCE(v_qty, 0); v_total := COALESCE(v_total, 0); v_avg := COALESCE(v_avg, 0);

  IF v_qty - p_quantity < 0 THEN
    RAISE EXCEPTION 'P0001:库存不足，当前库存 %，本次需出库 %', v_qty, p_quantity
      USING ERRCODE = 'check_violation';
  END IF;

  v_new_qty  := v_qty - p_quantity;
  v_out_cost := ROUND(p_quantity * v_avg, 2);
  IF v_new_qty = 0 THEN v_new_total := 0; ELSE v_new_total := v_total - v_out_cost; END IF;
  IF v_new_total < 0 THEN v_new_total := 0; END IF;

  UPDATE inv_stock
  SET quantity = v_new_qty, total_cost = v_new_total, updated_at = now()
  WHERE product_id = p_product_id;

  INSERT INTO inv_stock_movements
    (id, product_id, type, quantity, balance, source, ref_no, remark, unit_cost, created_by)
  VALUES
    (gen_random_uuid(), p_product_id, 'out', -p_quantity, v_new_qty,
     p_source, p_ref_no, p_remark, v_avg, p_user_id);
  RETURN v_new_qty;
END;
$$;

-- ------------------------------------------------------------
-- 4. 单据执行函数（单事务：状态流转 + 库存 + 流水）
-- ------------------------------------------------------------

-- 入库单审核通过：pending → approved，逐行入库（含移动加权成本）
CREATE OR REPLACE FUNCTION po_execute_receipt(p_receipt_id VARCHAR, p_user_id VARCHAR)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_status VARCHAR; v_receipt_no VARCHAR; v_estimated BOOLEAN;
  r RECORD;
BEGIN
  SELECT status, receipt_no, is_estimated INTO v_status, v_receipt_no, v_estimated
  FROM po_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:入库单不存在' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'P0400:仅待审入库单可审核通过，当前状态：%', v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR r IN SELECT product_id, quantity, unit_price FROM po_receipt_items WHERE receipt_id = p_receipt_id LOOP
    PERFORM inv_apply_receipt_in(
      r.product_id, r.quantity, r.unit_price, v_receipt_no,
      CASE WHEN v_estimated THEN '暂估入库' ELSE '采购入库' END, p_user_id
    );
  END LOOP;

  UPDATE po_receipts
  SET status = 'approved', approved_by = p_user_id, approved_at = now(), updated_at = now()
  WHERE id = p_receipt_id;
END;
$$;

-- 退货单审核通过：pending → approved，逐行出库（库存不足整单回滚）
CREATE OR REPLACE FUNCTION po_execute_return(p_return_id VARCHAR, p_user_id VARCHAR)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_status VARCHAR; v_return_no VARCHAR;
  r RECORD;
BEGIN
  SELECT status, return_no INTO v_status, v_return_no
  FROM po_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:退货单不存在' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'P0400:仅待审退货单可审核通过，当前状态：%', v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR r IN SELECT product_id, quantity FROM po_return_items WHERE return_id = p_return_id LOOP
    PERFORM inv_apply_issue_out(r.product_id, r.quantity, 'purchase_return', v_return_no, '采购退货出库', p_user_id);
  END LOOP;

  UPDATE po_returns
  SET status = 'approved', approved_by = p_user_id, approved_at = now(), updated_at = now()
  WHERE id = p_return_id;
END;
$$;

-- 暂估冲回：红字冲销原暂估（按暂估价出库）+ 蓝字按发票价重入库，原单置 reversed
-- p_items JSONB：[{"product_id":"..","quantity":..,"unit_price":..}]（实际来票数量与单价）
CREATE OR REPLACE FUNCTION po_reverse_receipt(
  p_receipt_id VARCHAR, p_invoice_no VARCHAR, p_items JSONB, p_user_id VARCHAR
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v RECORD;
  v_red_id VARCHAR := gen_random_uuid();
  v_blue_id VARCHAR := gen_random_uuid();
  v_red_no VARCHAR; v_blue_no VARCHAR;
  v_day VARCHAR := to_char(now(), 'YYYYMMDD');
  v_blue_total NUMERIC(14,2) := 0;
  item RECORD;
BEGIN
  SELECT * INTO v FROM po_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:入库单不存在' USING ERRCODE = 'no_data_found';
  END IF;
  IF v.status <> 'approved' OR NOT v.is_estimated THEN
    RAISE EXCEPTION 'P0400:仅已入库的暂估单可执行冲回，当前状态：%', v.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 单号：红字 GRR / 蓝字 GRB + 日期序号（取当日最大序号+1，防删除中间单后撞号）
  v_red_no  := 'GRR' || v_day || '-' || lpad((
    SELECT (COALESCE(MAX(CAST(substring(receipt_no from '-(\d+)$') AS INTEGER)), 0) + 1)::text
    FROM po_receipts WHERE receipt_no LIKE 'GRR' || v_day || '-%'), 4, '0');
  v_blue_no := 'GRB' || v_day || '-' || lpad((
    SELECT (COALESCE(MAX(CAST(substring(receipt_no from '-(\d+)$') AS INTEGER)), 0) + 1)::text
    FROM po_receipts WHERE receipt_no LIKE 'GRB' || v_day || '-%'), 4, '0');

  -- 红字单（直接 approved）：金额快照 = 原暂估金额
  INSERT INTO po_receipts
    (id, receipt_no, order_id, supplier_id, status, is_estimated, invoice_no,
     reversal_of_id, reversal_kind, total_amount, receive_date, remark, created_by, approved_by, approved_at)
  VALUES
    (v_red_id, v_red_no, v.order_id, v.supplier_id, 'approved', true, p_invoice_no,
     v.id, 'red', v.total_amount, CURRENT_DATE,
     '红字冲回 ' || v.receipt_no, p_user_id, p_user_id, now());
  INSERT INTO po_receipt_items (receipt_id, product_id, quantity, unit_price, amount, unit)
  SELECT v_red_id, product_id, quantity, unit_price, amount, unit
  FROM po_receipt_items WHERE receipt_id = v.id;

  -- 红字出库回冲（期间库存若已被销售占用导致不足 → 整事务回滚）
  FOR item IN SELECT product_id, quantity FROM po_receipt_items WHERE receipt_id = v.id LOOP
    PERFORM inv_apply_issue_out(item.product_id, item.quantity, 'receipt_reversal', v_red_no, '暂估红字冲回', p_user_id);
  END LOOP;

  -- 蓝字单（直接 approved）：按来票实际数量与单价
  INSERT INTO po_receipts
    (id, receipt_no, order_id, supplier_id, status, is_estimated, invoice_no,
     reversal_of_id, reversal_kind, total_amount, receive_date, remark, created_by, approved_by, approved_at)
  VALUES
    (v_blue_id, v_blue_no, v.order_id, v.supplier_id, 'approved', false, p_invoice_no,
     v.id, 'blue', 0, CURRENT_DATE,
     '蓝字重入 ' || v.receipt_no || '（发票 ' || COALESCE(p_invoice_no, '—') || '）', p_user_id, p_user_id, now());

  FOR item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id VARCHAR, quantity NUMERIC, unit_price NUMERIC) LOOP
    INSERT INTO po_receipt_items (receipt_id, product_id, quantity, unit_price, amount, unit)
    SELECT v_blue_id, item.product_id, item.quantity, item.unit_price,
           ROUND(item.quantity * item.unit_price, 2), p.unit
    FROM md_products p WHERE p.id = item.product_id;
    v_blue_total := v_blue_total + ROUND(item.quantity * item.unit_price, 2);
    PERFORM inv_apply_receipt_in(item.product_id, item.quantity, item.unit_price, v_blue_no, '来票蓝字入库', p_user_id);
  END LOOP;
  UPDATE po_receipts SET total_amount = v_blue_total WHERE id = v_blue_id;

  -- 原暂估单 → 已冲回
  UPDATE po_receipts
  SET status = 'reversed', invoice_no = p_invoice_no, updated_at = now()
  WHERE id = v.id;
END;
$$;

-- 订单一键到货入库（approved → received）：自动生成并审核一张正式入库单
CREATE OR REPLACE FUNCTION po_fulfill_order(p_order_id VARCHAR, p_user_id VARCHAR)
RETURNS VARCHAR
LANGUAGE plpgsql AS $$
DECLARE
  v_status VARCHAR; v_order_no VARCHAR; v_supplier VARCHAR; v_total NUMERIC(14,2);
  v_receipt_id VARCHAR := gen_random_uuid();
  v_receipt_no VARCHAR;
  v_existing INT;
  r RECORD;
BEGIN
  SELECT status, order_no, supplier_id, total_amount INTO v_status, v_order_no, v_supplier, v_total
  FROM po_purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:采购订单不存在' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'P0400:仅已审订单可到货入库，当前状态：%', v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 防重复入库：该订单已存在已审核的正式入库单时禁止一键入库
  SELECT COUNT(*) INTO v_existing FROM po_receipts
  WHERE order_id = p_order_id AND status = 'approved' AND reversal_kind IS NULL;
  IF v_existing > 0 THEN
    RAISE EXCEPTION 'P0400:该订单已存在已入库的入库单，禁止重复入库'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_receipt_no := 'GR' || to_char(now(), 'YYYYMMDD') || '-' || lpad((
    SELECT (COALESCE(MAX(CAST(substring(receipt_no from '-(\d+)$') AS INTEGER)), 0) + 1)::text
    FROM po_receipts WHERE receipt_no LIKE 'GR' || to_char(now(), 'YYYYMMDD') || '-%'), 4, '0');

  INSERT INTO po_receipts
    (id, receipt_no, order_id, supplier_id, status, is_estimated, total_amount, receive_date,
     remark, created_by, approved_by, approved_at)
  VALUES
    (v_receipt_id, v_receipt_no, p_order_id, v_supplier, 'approved', false, v_total,
     CURRENT_DATE, '订单到货一键入库', p_user_id, p_user_id, now());
  INSERT INTO po_receipt_items (receipt_id, product_id, quantity, unit_price, amount, unit)
  SELECT v_receipt_id, product_id, quantity, unit_price, amount, unit
  FROM po_purchase_order_items WHERE order_id = p_order_id;

  FOR r IN SELECT product_id, quantity, unit_price FROM po_purchase_order_items WHERE order_id = p_order_id LOOP
    PERFORM inv_apply_receipt_in(r.product_id, r.quantity, r.unit_price, v_receipt_no, '采购到货入库', p_user_id);
  END LOOP;

  UPDATE po_purchase_orders SET status = 'received', updated_at = now() WHERE id = p_order_id;
  RETURN v_receipt_no;
END;
$$;

-- 旧版整单入库函数由 po_fulfill_order 取代
DROP FUNCTION IF EXISTS inv_complete_purchase(VARCHAR, VARCHAR);
