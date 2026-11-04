-- ============================================================================
-- 0022_color_schema.sql — 色号（color_code）全链路贯通
--
-- 库存最小管理单元 = sku_code(product_id) + color_code + batch_no + warehouse。
-- 色号为空串 '' 表示「默认色/未分色」，存量数据迁移后全部落在 '' 桶，天然兼容。
--
-- 1) md_product_colors 色号档案（同一 SKU 型号下多个花色）
-- 2) 单据明细/库存/批次/台账/调拨/盘点/加工 全链路加 color_code/color_name
-- 3) inv_stock / inv_batches 唯一约束升级为含色号维度
-- 4) 13 个 plpgsql 函数色号化重写（DROP + CREATE，新增参数均带默认值向后兼容）
-- 幂等：IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / DROP IF EXISTS + CREATE。
-- ============================================================================

-- ============================================================
-- 1) 色号档案
-- ============================================================
CREATE TABLE IF NOT EXISTS md_product_colors (
  id          varchar(36) PRIMARY KEY DEFAULT gen_random_uuid()::varchar,
  product_id  varchar(36) NOT NULL REFERENCES md_products(id) ON DELETE CASCADE,
  color_code  varchar(32) NOT NULL,               -- 色号编码（同一商品内唯一）
  color_name  varchar(64) NOT NULL,               -- 色号名称（如 米白/浅灰/深灰）
  status      varchar(20) NOT NULL DEFAULT 'active',  -- active=可选 / disabled=停用（历史单据不受影响）
  remark      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT md_product_colors_unique UNIQUE (product_id, color_code)
);
CREATE INDEX IF NOT EXISTS md_product_colors_product_idx ON md_product_colors (product_id);
ALTER TABLE md_product_colors ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2) 全链路明细/库存加色号列（'' = 默认色，兼容存量）
-- ============================================================
-- 采购链路
ALTER TABLE po_requisition_items    ADD COLUMN IF NOT EXISTS color_code varchar(32) NOT NULL DEFAULT '';
ALTER TABLE po_requisition_items    ADD COLUMN IF NOT EXISTS color_name varchar(64);
ALTER TABLE po_purchase_order_items ADD COLUMN IF NOT EXISTS color_code varchar(32) NOT NULL DEFAULT '';
ALTER TABLE po_purchase_order_items ADD COLUMN IF NOT EXISTS color_name varchar(64);
ALTER TABLE po_receipt_items        ADD COLUMN IF NOT EXISTS color_code varchar(32) NOT NULL DEFAULT '';
ALTER TABLE po_receipt_items        ADD COLUMN IF NOT EXISTS color_name varchar(64);
ALTER TABLE po_return_items         ADD COLUMN IF NOT EXISTS color_code varchar(32) NOT NULL DEFAULT '';
ALTER TABLE po_return_items         ADD COLUMN IF NOT EXISTS color_name varchar(64);
-- 销售链路
ALTER TABLE so_sales_order_items    ADD COLUMN IF NOT EXISTS color_code varchar(32) NOT NULL DEFAULT '';
ALTER TABLE so_sales_order_items    ADD COLUMN IF NOT EXISTS color_name varchar(64);
ALTER TABLE so_shipment_items       ADD COLUMN IF NOT EXISTS color_code varchar(32) NOT NULL DEFAULT '';
ALTER TABLE so_shipment_items       ADD COLUMN IF NOT EXISTS color_name varchar(64);
ALTER TABLE so_return_items         ADD COLUMN IF NOT EXISTS color_code varchar(32) NOT NULL DEFAULT '';
ALTER TABLE so_return_items         ADD COLUMN IF NOT EXISTS color_name varchar(64);
-- 库存链路
ALTER TABLE inv_stock               ADD COLUMN IF NOT EXISTS color_code varchar(32) NOT NULL DEFAULT '';
ALTER TABLE inv_batches             ADD COLUMN IF NOT EXISTS color_code varchar(32) NOT NULL DEFAULT '';
ALTER TABLE inv_stock_ledger        ADD COLUMN IF NOT EXISTS color_code varchar(32) NOT NULL DEFAULT '';
ALTER TABLE inv_transfer_items      ADD COLUMN IF NOT EXISTS color_code varchar(32) NOT NULL DEFAULT '';
ALTER TABLE inv_transfer_items      ADD COLUMN IF NOT EXISTS color_name varchar(64);
ALTER TABLE inv_check_items         ADD COLUMN IF NOT EXISTS color_code varchar(32) NOT NULL DEFAULT '';
ALTER TABLE inv_check_items         ADD COLUMN IF NOT EXISTS color_name varchar(64);
-- 加工链路（投入/产出均带色号；''=默认色）
ALTER TABLE ma_manufacturing_items  ADD COLUMN IF NOT EXISTS color_code varchar(32) NOT NULL DEFAULT '';
ALTER TABLE ma_manufacturing_items  ADD COLUMN IF NOT EXISTS color_name varchar(64);

-- ============================================================
-- 3) 唯一约束升级：库存/批次最小单元含色号
-- ============================================================
ALTER TABLE inv_stock DROP CONSTRAINT IF EXISTS inv_stock_warehouse_product_unique;
ALTER TABLE inv_stock DROP CONSTRAINT IF EXISTS inv_stock_wh_product_color_unique;
ALTER TABLE inv_stock ADD CONSTRAINT inv_stock_wh_product_color_unique UNIQUE (warehouse_id, product_id, color_code);

ALTER TABLE inv_batches DROP CONSTRAINT IF EXISTS inv_batches_unique;
ALTER TABLE inv_batches ADD CONSTRAINT inv_batches_unique UNIQUE (product_id, warehouse_id, batch_no, color_code);

CREATE INDEX IF NOT EXISTS inv_stock_color_idx ON inv_stock (product_id, color_code);
CREATE INDEX IF NOT EXISTS inv_batches_color_idx ON inv_batches (product_id, color_code);
CREATE INDEX IF NOT EXISTS inv_mov_color_idx ON inv_stock_ledger (product_id, color_code);

-- ============================================================
-- 4) plpgsql 函数色号化重写
--    新增 p_color_code 参数均放末位并带默认值 ''，既有调用方（含 mo_execute_*）无需改动。
-- ============================================================

-- 4.1 入库（仓+商品+色号 维度移动加权）
DROP FUNCTION IF EXISTS inv_apply_receipt_in(varchar, varchar, numeric, numeric, varchar, varchar, text, varchar);
DROP FUNCTION IF EXISTS inv_apply_receipt_in(varchar, varchar, numeric, numeric, varchar, varchar, text, varchar, varchar);
CREATE FUNCTION inv_apply_receipt_in(
  p_product   varchar,
  p_warehouse varchar,
  p_qty       numeric,
  p_unit_cost numeric,
  p_source    varchar,
  p_ref_no    varchar,
  p_remark    text,
  p_user      varchar,
  p_color_code varchar DEFAULT ''
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_warehouse varchar := COALESCE(p_warehouse, (SELECT id FROM inv_warehouses WHERE code='WH01'));
  v_color     varchar := COALESCE(p_color_code, '');
  v_qty numeric; v_cost numeric; v_avg numeric; v_new_qty numeric; v_new_cost numeric; v_batch_id varchar;
BEGIN
  INSERT INTO inv_stock (warehouse_id, product_id, color_code, quantity, avg_cost, total_cost)
  VALUES (v_warehouse, p_product, v_color, 0, 0, 0)
  ON CONFLICT (warehouse_id, product_id, color_code) DO NOTHING;
  SELECT quantity, total_cost INTO v_qty, v_cost FROM inv_stock
    WHERE warehouse_id=v_warehouse AND product_id=p_product AND color_code=v_color FOR UPDATE;
  v_new_qty := v_qty + p_qty;
  v_new_cost := v_cost + ROUND(p_qty * p_unit_cost, 2);
  v_avg := CASE WHEN v_new_qty > 0 THEN ROUND(v_new_cost / v_new_qty, 4) ELSE 0 END;
  UPDATE inv_stock SET quantity=v_new_qty, total_cost=v_new_cost, avg_cost=v_avg, updated_at=NOW()
    WHERE warehouse_id=v_warehouse AND product_id=p_product AND color_code=v_color;

  INSERT INTO inv_batches (batch_no, product_id, warehouse_id, color_code, unit_cost, initial_quantity, remaining_quantity, source_ref)
  VALUES (p_ref_no, p_product, v_warehouse, v_color, p_unit_cost, p_qty, p_qty, p_ref_no)
  ON CONFLICT (product_id, warehouse_id, batch_no, color_code)
  DO UPDATE SET initial_quantity = inv_batches.initial_quantity + EXCLUDED.initial_quantity,
                remaining_quantity = inv_batches.remaining_quantity + EXCLUDED.remaining_quantity
  RETURNING id INTO v_batch_id;

  INSERT INTO inv_stock_ledger (warehouse_id, product_id, color_code, batch_id, type, quantity, balance, source, unit_cost, ref_no, remark, created_by)
  VALUES (v_warehouse, p_product, v_color, v_batch_id, 'in', p_qty, v_new_qty, p_source, p_unit_cost, p_ref_no, p_remark, p_user);
END; $$;

-- 4.2 出库（仓+商品+色号 维度 FIFO 扣批次 + 按均价出库）
DROP FUNCTION IF EXISTS inv_apply_issue_out(varchar, varchar, numeric, varchar, varchar, text, varchar);
DROP FUNCTION IF EXISTS inv_apply_issue_out(varchar, varchar, numeric, varchar, varchar, text, varchar, varchar);
CREATE FUNCTION inv_apply_issue_out(
  p_product   varchar,
  p_warehouse varchar,
  p_qty       numeric,
  p_source    varchar,
  p_ref_no    varchar,
  p_remark    text,
  p_user      varchar,
  p_color_code varchar DEFAULT ''
) RETURNS numeric
LANGUAGE plpgsql AS $$
DECLARE
  v_warehouse varchar := COALESCE(p_warehouse, (SELECT id FROM inv_warehouses WHERE code='WH01'));
  v_color     varchar := COALESCE(p_color_code, '');
  v_qty numeric; v_cost numeric; v_avg numeric; v_new_qty numeric; v_out_cost numeric;
  v_batch RECORD; v_remain numeric := p_qty; v_first_batch varchar;
BEGIN
  SELECT quantity, total_cost, avg_cost INTO v_qty, v_cost, v_avg FROM inv_stock
    WHERE warehouse_id=v_warehouse AND product_id=p_product AND color_code=v_color FOR UPDATE;
  IF NOT FOUND OR v_qty < p_qty THEN
    RAISE EXCEPTION '库存不足' USING ERRCODE = 'P0001';
  END IF;

  -- FIFO：按入库时间顺序扣减批次剩余量（仅同色号批次，不串色）
  FOR v_batch IN
    SELECT id, remaining_quantity FROM inv_batches
     WHERE product_id=p_product AND warehouse_id=v_warehouse AND color_code=v_color AND remaining_quantity > 0
     ORDER BY created_at ASC FOR UPDATE
  LOOP
    EXIT WHEN v_remain <= 0;
    IF v_first_batch IS NULL THEN v_first_batch := v_batch.id; END IF;
    IF v_batch.remaining_quantity >= v_remain THEN
      UPDATE inv_batches SET remaining_quantity = remaining_quantity - v_remain WHERE id = v_batch.id;
      v_remain := 0;
    ELSE
      UPDATE inv_batches SET remaining_quantity = 0 WHERE id = v_batch.id;
      v_remain := v_remain - v_batch.remaining_quantity;
    END IF;
  END LOOP;

  v_out_cost := ROUND(p_qty * v_avg, 2);
  v_new_qty := v_qty - p_qty;
  UPDATE inv_stock SET quantity=v_new_qty,
                       total_cost=GREATEST(v_cost - v_out_cost, 0),
                       avg_cost=CASE WHEN v_new_qty > 0 THEN ROUND(GREATEST(v_cost - v_out_cost,0)/v_new_qty,4) ELSE 0 END,
                       updated_at=NOW()
    WHERE warehouse_id=v_warehouse AND product_id=p_product AND color_code=v_color;

  INSERT INTO inv_stock_ledger (warehouse_id, product_id, color_code, batch_id, type, quantity, balance, source, unit_cost, ref_no, remark, created_by)
  VALUES (v_warehouse, p_product, v_color, v_first_batch, 'out', -p_qty, v_new_qty, p_source, v_avg, p_ref_no, p_remark, p_user);
  RETURN v_out_cost;
END; $$;

-- 4.3 采购入库终审（按行色号入库）
DROP FUNCTION IF EXISTS po_execute_receipt(varchar, varchar);
CREATE FUNCTION po_execute_receipt(p_receipt_id varchar, p_user_id varchar)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r RECORD; it RECORD;
BEGIN
  SELECT * INTO r FROM po_receipts WHERE id=p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '入库单不存在' USING ERRCODE='P0404'; END IF;
  IF r.status != 'pending' THEN RAISE EXCEPTION '入库单状态不允许入库' USING ERRCODE='P0400'; END IF;
  FOR it IN SELECT * FROM po_receipt_items WHERE receipt_id=r.id LOOP
    PERFORM inv_apply_receipt_in(it.product_id, r.warehouse_id, it.quantity, it.unit_price,
      CASE WHEN r.reversal_kind='blue' THEN 'receipt_reversal' ELSE 'purchase_in' END,
      r.receipt_no, '采购入库终审', p_user_id, it.color_code);
  END LOOP;
  UPDATE po_receipts SET status='approved', approved_by=p_user_id, approved_at=NOW(), updated_at=NOW() WHERE id=r.id;
END; $$;

-- 4.4 采购退货终审（按行色号出库）
DROP FUNCTION IF EXISTS po_execute_return(varchar, varchar);
CREATE FUNCTION po_execute_return(p_return_id varchar, p_user_id varchar)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r RECORD; it RECORD; o RECORD;
BEGIN
  SELECT * INTO r FROM po_returns WHERE id=p_return_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '退货单不存在' USING ERRCODE='P0404'; END IF;
  IF r.status != 'pending' THEN RAISE EXCEPTION '退货单状态不允许出库' USING ERRCODE='P0400'; END IF;
  SELECT warehouse_id INTO o FROM po_purchase_orders WHERE id=r.order_id;
  FOR it IN SELECT * FROM po_return_items WHERE return_id=r.id LOOP
    PERFORM inv_apply_issue_out(it.product_id, o.warehouse_id, it.quantity,
      'purchase_return', r.return_no, '采购退货出库', p_user_id, it.color_code);
  END LOOP;
  UPDATE po_returns SET status='approved', approved_by=p_user_id, approved_at=NOW(), updated_at=NOW() WHERE id=r.id;
END; $$;

-- 4.5 暂估冲回（红蓝单均按原行色号）
DROP FUNCTION IF EXISTS po_reverse_receipt(varchar, varchar, jsonb, varchar);
CREATE FUNCTION po_reverse_receipt(p_receipt_id varchar, p_invoice_no varchar, p_items jsonb, p_user_id varchar)
RETURNS json LANGUAGE plpgsql AS $$
DECLARE r RECORD; red_id varchar; blue_id varchar; it RECORD; pj RECORD; v_supplier varchar;
  red_no varchar; blue_no varchar; red_total numeric := 0; blue_total numeric := 0; v_warehouse varchar;
BEGIN
  SELECT * INTO r FROM po_receipts WHERE id=p_receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '入库单不存在' USING ERRCODE='P0404'; END IF;
  IF r.status != 'approved' OR NOT r.is_estimated THEN
    RAISE EXCEPTION '仅已审批的暂估入库单可冲回' USING ERRCODE='P0400';
  END IF;
  SELECT supplier_id INTO v_supplier FROM po_purchase_orders WHERE id = r.order_id;
  v_warehouse := r.warehouse_id;
  red_no  := 'GRR' || to_char(CURRENT_DATE,'yyyymmdd') || '-' ||
             lpad(((SELECT COALESCE(MAX(substring(receipt_no from '-(\d+)$'))::int,0)+1 FROM po_receipts WHERE receipt_no LIKE 'GRR%') )::text, 4, '0');
  blue_no := 'GRB' || to_char(CURRENT_DATE,'yyyymmdd') || '-' ||
             lpad(((SELECT COALESCE(MAX(substring(receipt_no from '-(\d+)$'))::int,0)+1 FROM po_receipts WHERE receipt_no LIKE 'GRB%') )::text, 4, '0');

  INSERT INTO po_receipts (receipt_no, order_id, supplier_id, status, is_estimated, reversal_of_id, reversal_kind, total_amount, receive_date, remark, warehouse_id, created_by, approved_by, approved_at)
  VALUES (red_no, r.order_id, v_supplier, 'approved', true, r.id, 'red', 0, CURRENT_DATE, '暂估冲回-红字', v_warehouse, p_user_id, p_user_id, NOW()) RETURNING id INTO red_id;
  FOR it IN SELECT * FROM po_receipt_items WHERE receipt_id=r.id LOOP
    INSERT INTO po_receipt_items (receipt_id, product_id, color_code, color_name, quantity, unit_price, amount, unit)
    VALUES (red_id, it.product_id, it.color_code, it.color_name, it.quantity, it.unit_price, it.amount, it.unit);
    red_total := red_total + it.amount;
    PERFORM inv_apply_issue_out(it.product_id, v_warehouse, it.quantity, 'receipt_reversal', red_no, '暂估冲回红字出库', p_user_id, it.color_code);
  END LOOP;
  UPDATE po_receipts SET total_amount=red_total WHERE id=red_id;

  INSERT INTO po_receipts (receipt_no, order_id, supplier_id, status, is_estimated, invoice_no, reversal_of_id, reversal_kind, total_amount, receive_date, remark, warehouse_id, created_by, approved_by, approved_at)
  VALUES (blue_no, r.order_id, v_supplier, 'approved', false, p_invoice_no, r.id, 'blue', 0, CURRENT_DATE, '暂估冲回-蓝字(按发票价)', v_warehouse, p_user_id, p_user_id, NOW()) RETURNING id INTO blue_id;
  FOR pj IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id varchar, color_code varchar, unit_price numeric) LOOP
    SELECT * INTO it FROM po_receipt_items WHERE receipt_id=r.id AND product_id=pj.product_id AND color_code=COALESCE(pj.color_code,'') LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION '冲回明细与原单不符' USING ERRCODE='P0400'; END IF;
    INSERT INTO po_receipt_items (receipt_id, product_id, color_code, color_name, quantity, unit_price, amount, unit)
    VALUES (blue_id, it.product_id, it.color_code, it.color_name, it.quantity, pj.unit_price, ROUND(it.quantity*pj.unit_price,2), it.unit);
    blue_total := blue_total + ROUND(it.quantity*pj.unit_price,2);
    PERFORM inv_apply_receipt_in(it.product_id, v_warehouse, it.quantity, pj.unit_price, 'receipt_reversal', blue_no, '暂估冲回蓝字入库', p_user_id, it.color_code);
  END LOOP;
  UPDATE po_receipts SET total_amount=blue_total WHERE id=blue_id;

  UPDATE po_receipts SET status='reversed', updated_at=NOW() WHERE id=r.id;
  RETURN json_build_object('red_receipt_id', red_id, 'blue_receipt_id', blue_id, 'red_no', red_no, 'blue_no', blue_no);
END; $$;

-- 4.6 采购订单一键到货入库（色号随行带入入库单）
DROP FUNCTION IF EXISTS po_fulfill_order(varchar, varchar);
CREATE FUNCTION po_fulfill_order(p_order_id varchar, p_user_id varchar)
RETURNS varchar LANGUAGE plpgsql AS $$
DECLARE o RECORD; it RECORD; rid varchar; rno varchar;
BEGIN
  SELECT * INTO o FROM po_purchase_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '采购订单不存在' USING ERRCODE='P0404'; END IF;
  IF o.status != 'approved' THEN RAISE EXCEPTION '仅已审采购订单可执行到货入库' USING ERRCODE='P0400'; END IF;
  IF EXISTS (SELECT 1 FROM po_receipts WHERE order_id=o.id AND reversal_kind IS NULL AND status IN ('pending','approved')) THEN
    RAISE EXCEPTION '该订单已生成入库单，请勿重复入库' USING ERRCODE='P0400';
  END IF;
  rno := 'GR' || to_char(CURRENT_DATE,'yyyymmdd') || '-' ||
         lpad(((SELECT COALESCE(MAX(substring(receipt_no from '-(\d+)$'))::int,0)+1 FROM po_receipts WHERE receipt_no LIKE 'GR%'))::text, 4, '0');
  INSERT INTO po_receipts (receipt_no, order_id, supplier_id, status, is_estimated, total_amount, receive_date, remark, warehouse_id, created_by, approved_by, approved_at)
  VALUES (rno, o.id, o.supplier_id, 'approved', false, o.total_amount, CURRENT_DATE, '订单一键到货入库', o.warehouse_id, p_user_id, p_user_id, NOW()) RETURNING id INTO rid;
  FOR it IN SELECT * FROM po_purchase_order_items WHERE order_id=o.id LOOP
    INSERT INTO po_receipt_items (receipt_id, product_id, color_code, color_name, quantity, unit_price, amount, unit)
    VALUES (rid, it.product_id, it.color_code, it.color_name, it.quantity, it.unit_price, it.amount, it.unit);
    PERFORM inv_apply_receipt_in(it.product_id, o.warehouse_id, it.quantity, it.unit_price, 'purchase_in', rno, '订单一键到货入库', p_user_id, it.color_code);
  END LOOP;
  UPDATE po_purchase_orders SET status='received', updated_at=NOW() WHERE id=o.id;
  RETURN rid;
END; $$;

-- 4.7 销售出库终审（按行色号扣库存，数量强校验不串色）
DROP FUNCTION IF EXISTS so_execute_shipment(varchar, varchar);
CREATE FUNCTION so_execute_shipment(p_shipment_id varchar, p_user_id varchar)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE s RECORD; it RECORD; o RECORD; v_cost numeric; v_total_cost numeric := 0;
  v_warehouse varchar; v_shipped numeric; v_all_done boolean := true; l RECORD;
BEGIN
  SELECT * INTO s FROM so_shipments WHERE id=p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '出库单不存在' USING ERRCODE='P0404'; END IF;
  IF s.status != 'pending' THEN RAISE EXCEPTION '出库单状态不允许出库' USING ERRCODE='P0400'; END IF;
  SELECT warehouse_id INTO o FROM so_sales_orders WHERE id=s.order_id;
  v_warehouse := COALESCE(s.warehouse_id, o.warehouse_id, (SELECT id FROM inv_warehouses WHERE code='WH01'));
  FOR it IN SELECT * FROM so_shipment_items WHERE shipment_id=s.id LOOP
    -- 数量强校验：累计已出库(其他正式单，同商品同色号) + 本单 ≤ 订单量
    IF (SELECT COALESCE(SUM(si.quantity),0) FROM so_shipment_items si
        JOIN so_shipments sh ON sh.id=si.shipment_id
        WHERE sh.order_id=s.order_id AND si.product_id=it.product_id AND si.color_code=it.color_code
          AND sh.status='approved' AND sh.id != s.id) + it.quantity >
       (SELECT quantity FROM so_sales_order_items WHERE order_id=s.order_id AND product_id=it.product_id AND color_code=it.color_code LIMIT 1)
    THEN RAISE EXCEPTION '出库数量超过订单剩余量' USING ERRCODE='P0001'; END IF;
    v_cost := inv_apply_issue_out(it.product_id, v_warehouse, it.quantity, 'sales_out', s.shipment_no, '销售出库终审', p_user_id, it.color_code);
    v_total_cost := v_total_cost + v_cost;
    UPDATE so_shipment_items SET cost = v_cost WHERE id = it.id;
  END LOOP;
  UPDATE so_shipments SET status='approved', total_cost=v_total_cost, warehouse_id=v_warehouse,
         approved_by=p_user_id, approved_at=NOW(), updated_at=NOW() WHERE id=s.id;

  -- 按 商品×色号 维度判定订单是否全部出库完成
  FOR l IN SELECT product_id, color_code, quantity FROM so_sales_order_items WHERE order_id = s.order_id LOOP
    SELECT COALESCE(SUM(i.quantity), 0) INTO v_shipped
      FROM so_shipment_items i JOIN so_shipments sh ON sh.id = i.shipment_id
     WHERE sh.order_id = s.order_id AND sh.status = 'approved'
       AND i.product_id = l.product_id AND i.color_code = l.color_code;
    IF v_shipped < l.quantity THEN v_all_done := false; END IF;
  END LOOP;
  IF v_all_done THEN
    UPDATE so_sales_orders SET status='shipped', updated_at=NOW() WHERE id=s.order_id;
  END IF;
END; $$;

-- 4.8 销售退货终审（按行色号回补）
DROP FUNCTION IF EXISTS so_execute_return(varchar, varchar);
CREATE FUNCTION so_execute_return(p_return_id varchar, p_user_id varchar)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE r RECORD; it RECORD; v_wh varchar;
BEGIN
  SELECT * INTO r FROM so_returns WHERE id=p_return_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '退货单不存在' USING ERRCODE='P0404'; END IF;
  IF r.status != 'pending' THEN RAISE EXCEPTION '退货单状态不允许入库' USING ERRCODE='P0400'; END IF;
  SELECT COALESCE(warehouse_id,(SELECT id FROM inv_warehouses WHERE code='WH01')) INTO v_wh FROM so_sales_orders WHERE id=r.order_id;
  FOR it IN SELECT * FROM so_return_items WHERE return_id=r.id LOOP
    -- 数量强校验：累计已退(其他正式单，同商品同色号) + 本单 ≤ 累计已出库
    IF (SELECT COALESCE(SUM(ri.quantity),0) FROM so_return_items ri JOIN so_returns rr ON rr.id=ri.return_id
        WHERE rr.order_id=r.order_id AND ri.product_id=it.product_id AND ri.color_code=it.color_code
          AND rr.status='approved' AND rr.id != r.id) + it.quantity >
       (SELECT COALESCE(SUM(si.quantity),0) FROM so_shipment_items si JOIN so_shipments sh ON sh.id=si.shipment_id
        WHERE sh.order_id=r.order_id AND si.product_id=it.product_id AND si.color_code=it.color_code AND sh.status='approved')
    THEN RAISE EXCEPTION '退货数量超过已出库量' USING ERRCODE='P0001'; END IF;
    PERFORM inv_apply_receipt_in(it.product_id, v_wh, it.quantity,
      COALESCE(it.unit_cost, (SELECT avg_cost FROM inv_stock WHERE warehouse_id=v_wh AND product_id=it.product_id AND color_code=it.color_code), 0),
      'sales_return_in', r.return_no, '销售退货入库', p_user_id, it.color_code);
  END LOOP;
  UPDATE so_returns SET status='approved', approved_by=p_user_id, approved_at=NOW(), updated_at=NOW() WHERE id=r.id;
END; $$;

-- 4.9 销售订单一键发货出库（色号随行带出库单）
DROP FUNCTION IF EXISTS so_fulfill_order(varchar, varchar);
CREATE FUNCTION so_fulfill_order(p_order_id varchar, p_user_id varchar)
RETURNS varchar LANGUAGE plpgsql AS $$
DECLARE o RECORD; it RECORD; sid varchar; sno varchar; v_cost numeric; v_total_cost numeric := 0; v_warehouse varchar;
BEGIN
  SELECT * INTO o FROM so_sales_orders WHERE id=p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '销售订单不存在' USING ERRCODE='P0404'; END IF;
  IF o.status != 'approved' THEN RAISE EXCEPTION '仅已审销售订单可执行发货出库' USING ERRCODE='P0400'; END IF;
  IF EXISTS (SELECT 1 FROM so_shipments WHERE order_id=o.id AND status IN ('pending','approved')) THEN
    RAISE EXCEPTION '该订单已生成出库单，请勿重复出库' USING ERRCODE='P0400';
  END IF;
  v_warehouse := COALESCE(o.warehouse_id, (SELECT id FROM inv_warehouses WHERE code='WH01'));
  sno := 'SH' || to_char(CURRENT_DATE,'yyyymmdd') || '-' ||
         lpad(((SELECT COALESCE(MAX(substring(shipment_no from '-(\d+)$'))::int,0)+1 FROM so_shipments WHERE shipment_no LIKE 'SH%'))::text, 4, '0');
  INSERT INTO so_shipments (shipment_no, order_id, customer_id, warehouse_id, status, total_amount, total_cost, ship_date, remark, created_by, approved_by, approved_at)
  VALUES (sno, o.id, o.customer_id, v_warehouse, 'approved', o.total_amount, 0, CURRENT_DATE, '订单一键发货出库', p_user_id, p_user_id, NOW()) RETURNING id INTO sid;
  FOR it IN SELECT * FROM so_sales_order_items WHERE order_id=o.id LOOP
    INSERT INTO so_shipment_items (shipment_id, product_id, color_code, color_name, quantity, unit_price, amount, unit)
    VALUES (sid, it.product_id, it.color_code, it.color_name, it.quantity, it.unit_price, it.amount, it.unit);
    v_cost := inv_apply_issue_out(it.product_id, v_warehouse, it.quantity, 'sales_out', sno, '订单一键发货出库', p_user_id, it.color_code);
    v_total_cost := v_total_cost + v_cost;
    UPDATE so_shipment_items SET cost = v_cost
     WHERE shipment_id = sid AND product_id = it.product_id AND color_code = it.color_code;
  END LOOP;
  UPDATE so_shipments SET total_cost = v_total_cost WHERE id = sid;
  UPDATE so_sales_orders SET status='shipped', updated_at=NOW() WHERE id=o.id;
  RETURN sid;
END; $$;

-- 4.10 冻结量调整（色号维度）
-- 注意：既有签名为 (p_product_id, p_warehouse_id, p_delta, p_user_id)，
-- 追加 p_color_code 末位缺省参数保持 RPC 调用兼容。
DROP FUNCTION IF EXISTS inv_adjust_frozen(varchar, varchar, numeric);
DROP FUNCTION IF EXISTS inv_adjust_frozen(varchar, varchar, numeric, varchar);
DROP FUNCTION IF EXISTS inv_adjust_frozen(varchar, varchar, numeric, varchar, varchar);
CREATE FUNCTION inv_adjust_frozen(
  p_product_id varchar, p_warehouse_id varchar, p_delta numeric, p_user_id varchar,
  p_color_code varchar DEFAULT '')
RETURNS numeric LANGUAGE plpgsql AS $$
DECLARE
  v_qty NUMERIC(14,3);
  v_frozen NUMERIC(14,3);
  v_new NUMERIC(14,3);
  v_color varchar := COALESCE(p_color_code, '');
BEGIN
  SELECT quantity, frozen_quantity INTO v_qty, v_frozen
  FROM inv_stock
  WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id AND color_code = v_color
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:该仓库无此商品该色号库存行' USING ERRCODE = 'no_data_found';
  END IF;
  v_new := v_frozen + p_delta;
  IF v_new < 0 THEN
    RAISE EXCEPTION 'P0400:冻结量不能为负（当前 %，调整 %）', v_frozen, p_delta
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v_qty - v_new < 0 THEN
    RAISE EXCEPTION 'P0001:冻结量超出现有量（现有 %，冻结后 %）', v_qty, v_new
      USING ERRCODE = 'check_violation';
  END IF;
  UPDATE inv_stock SET frozen_quantity = v_new, updated_at = now()
  WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id AND color_code = v_color;
  RETURN v_new;
END; $$;

-- 4.11 调拨终审（色号维度调出/在途）
DROP FUNCTION IF EXISTS inv_execute_transfer(varchar, varchar);
CREATE FUNCTION inv_execute_transfer(p_transfer_id varchar, p_user_id varchar)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE t RECORD; it RECORD;
BEGIN
  SELECT * INTO t FROM inv_transfers WHERE id=p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '调拨单不存在' USING ERRCODE='P0404'; END IF;
  IF t.status != 'pending' THEN RAISE EXCEPTION '调拨单状态不允许执行' USING ERRCODE='P0400'; END IF;
  FOR it IN SELECT * FROM inv_transfer_items WHERE transfer_id=t.id LOOP
    PERFORM inv_apply_issue_out(it.product_id, t.from_warehouse_id, it.quantity, 'transfer_out', t.transfer_no, '调拨终审调出', p_user_id, it.color_code);
    INSERT INTO inv_stock (warehouse_id, product_id, color_code, in_transit)
    VALUES (t.to_warehouse_id, it.product_id, it.color_code, it.quantity)
    ON CONFLICT (warehouse_id, product_id, color_code)
    DO UPDATE SET in_transit = inv_stock.in_transit + EXCLUDED.in_transit, updated_at=NOW();
  END LOOP;
  UPDATE inv_transfers SET status='approved', approved_by=p_user_id, approved_at=NOW(), updated_at=NOW() WHERE id=t.id;
END; $$;

-- 4.12 调拨收货（在途转现有+批次，色号维度）
DROP FUNCTION IF EXISTS inv_receive_transfer(varchar, varchar);
CREATE FUNCTION inv_receive_transfer(p_transfer_id varchar, p_user_id varchar)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE t RECORD; it RECORD; v_cost numeric; v_batch_id varchar; v_qty numeric; v_total numeric; v_avg numeric;
BEGIN
  SELECT * INTO t FROM inv_transfers WHERE id=p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '调拨单不存在' USING ERRCODE='P0404'; END IF;
  IF t.status != 'approved' THEN RAISE EXCEPTION '仅已审调拨单可收货' USING ERRCODE='P0400'; END IF;
  FOR it IN SELECT * FROM inv_transfer_items WHERE transfer_id=t.id LOOP
    v_cost := COALESCE(it.unit_cost, 0);
    UPDATE inv_stock SET in_transit = GREATEST(in_transit - it.quantity, 0), updated_at=NOW()
     WHERE warehouse_id=t.to_warehouse_id AND product_id=it.product_id AND color_code=it.color_code;

    INSERT INTO inv_stock (warehouse_id, product_id, color_code, quantity, avg_cost, total_cost)
    VALUES (t.to_warehouse_id, it.product_id, it.color_code, 0, 0, 0)
    ON CONFLICT (warehouse_id, product_id, color_code) DO NOTHING;
    SELECT quantity, total_cost INTO v_qty, v_total FROM inv_stock
     WHERE warehouse_id=t.to_warehouse_id AND product_id=it.product_id AND color_code=it.color_code FOR UPDATE;
    v_total := v_total + ROUND(it.quantity * v_cost, 2);
    v_qty := v_qty + it.quantity;
    v_avg := CASE WHEN v_qty > 0 THEN ROUND(v_total / v_qty, 4) ELSE 0 END;
    UPDATE inv_stock SET quantity=v_qty, total_cost=v_total, avg_cost=v_avg, updated_at=NOW()
     WHERE warehouse_id=t.to_warehouse_id AND product_id=it.product_id AND color_code=it.color_code;

    INSERT INTO inv_batches (batch_no, product_id, warehouse_id, color_code, unit_cost, initial_quantity, remaining_quantity, source_ref)
    VALUES (t.transfer_no, it.product_id, t.to_warehouse_id, it.color_code, v_cost, it.quantity, it.quantity, t.transfer_no)
    ON CONFLICT (product_id, warehouse_id, batch_no, color_code)
    DO UPDATE SET initial_quantity = inv_batches.initial_quantity + EXCLUDED.initial_quantity,
                  remaining_quantity = inv_batches.remaining_quantity + EXCLUDED.remaining_quantity
    RETURNING id INTO v_batch_id;

    INSERT INTO inv_stock_ledger (warehouse_id, product_id, color_code, batch_id, type, quantity, balance, source, unit_cost, ref_no, remark, created_by)
    VALUES (t.to_warehouse_id, it.product_id, it.color_code, v_batch_id, 'in', it.quantity, v_qty, 'transfer_in', v_cost, t.transfer_no, '调拨收货', p_user_id);
  END LOOP;
  UPDATE inv_transfers SET status='received', received_at=NOW(), updated_at=NOW() WHERE id=t.id;
END; $$;

-- 4.13 盘点终审（色号维度差异过账）
DROP FUNCTION IF EXISTS inv_execute_check(varchar, varchar);
CREATE FUNCTION inv_execute_check(p_check_id varchar, p_user_id varchar)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE c RECORD; it RECORD;
BEGIN
  SELECT * INTO c FROM inv_checks WHERE id=p_check_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '盘点单不存在' USING ERRCODE='P0404'; END IF;
  IF c.status != 'pending' THEN RAISE EXCEPTION '盘点单状态不允许执行' USING ERRCODE='P0400'; END IF;
  IF EXISTS (SELECT 1 FROM inv_check_items WHERE check_id=c.id AND counted_quantity IS NULL) THEN
    RAISE EXCEPTION '存在未录入实盘数量的明细' USING ERRCODE='P0400';
  END IF;
  FOR it IN SELECT * FROM inv_check_items WHERE check_id=c.id AND difference != 0 LOOP
    IF it.difference > 0 THEN
      PERFORM inv_apply_receipt_in(it.product_id, c.warehouse_id, it.difference,
        COALESCE((SELECT avg_cost FROM inv_stock WHERE warehouse_id=c.warehouse_id AND product_id=it.product_id AND color_code=it.color_code),0),
        'check_in', c.check_no, '盘盈入库', p_user_id, it.color_code);
    ELSE
      PERFORM inv_apply_issue_out(it.product_id, c.warehouse_id, -it.difference, 'check_out', c.check_no, '盘亏出库', p_user_id, it.color_code);
    END IF;
  END LOOP;
  UPDATE inv_checks SET status='approved', approved_by=p_user_id, approved_at=NOW(), updated_at=NOW() WHERE id=c.id;
END; $$;

-- 4.14 加工领料（按投入行色号出库；jsonb 可带 color_code 精确匹配）
DROP FUNCTION IF EXISTS mo_execute_issue(varchar, varchar, jsonb, varchar);
CREATE FUNCTION mo_execute_issue(p_mo_id varchar, p_warehouse_id varchar, p_items jsonb, p_user_id varchar)
RETURNS numeric
LANGUAGE plpgsql
AS $$ DECLARE v_no varchar; v_status varchar; item jsonb; rowr record; v_qty numeric; v_cost numeric := 0; c numeric; v_color varchar;
BEGIN
  SELECT doc_no,status INTO v_no,v_status FROM ma_manufacturing_orders WHERE id=p_mo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MA_NOT_FOUND' USING ERRCODE='P0404'; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'MA_BAD_STATE' USING ERRCODE='P0400'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (item->>'quantity')::numeric;
    v_color := COALESCE(item->>'color_code', '');
    SELECT * INTO rowr FROM ma_manufacturing_items
     WHERE mo_id=p_mo_id AND kind='input' AND product_id=(item->>'product_id') AND color_code=v_color;
    IF NOT FOUND THEN RAISE EXCEPTION 'MA_BAD_PARAM' USING ERRCODE='P0400'; END IF;
    IF rowr.done_quantity + v_qty > rowr.quantity THEN RAISE EXCEPTION 'MA_OVER_ISSUE' USING ERRCODE='P0001'; END IF;
    SELECT inv_apply_issue_out(rowr.product_id, p_warehouse_id, v_qty, 'manufacture_issue', v_no, '加工领料', p_user_id, v_color) INTO c;
    v_cost := v_cost + COALESCE(c,0);
    UPDATE ma_manufacturing_items SET done_quantity=done_quantity+v_qty WHERE id=rowr.id;
  END LOOP;
  UPDATE ma_manufacturing_orders SET issued_cost=issued_cost+v_cost WHERE id=p_mo_id;
  RETURN v_cost;
END $$;

-- 4.15 加工完工（按产出行色号入库）
DROP FUNCTION IF EXISTS mo_execute_finish(varchar, varchar, jsonb, varchar);
CREATE FUNCTION mo_execute_finish(p_mo_id varchar, p_warehouse_id varchar, p_items jsonb, p_user_id varchar)
RETURNS numeric
LANGUAGE plpgsql
AS $$ DECLARE v_no varchar; v_status varchar; v_loss numeric; item jsonb; rowr record; v_qty numeric; v_input_done numeric := 0; v_output_done numeric := 0; v_this_qty numeric := 0; v_avail numeric := 0; v_unit numeric := 0; v_alloc numeric := 0; v_color varchar;
BEGIN
  SELECT doc_no,status,loss_ratio INTO v_no,v_status,v_loss FROM ma_manufacturing_orders WHERE id=p_mo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MA_NOT_FOUND' USING ERRCODE='P0404'; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'MA_BAD_STATE' USING ERRCODE='P0400'; END IF;
  SELECT COALESCE(sum(done_quantity),0) INTO v_input_done FROM ma_manufacturing_items WHERE mo_id=p_mo_id AND kind='input';
  SELECT COALESCE(sum(done_quantity),0) INTO v_output_done FROM ma_manufacturing_items WHERE mo_id=p_mo_id AND kind='output';
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP v_this_qty := v_this_qty + ((item->>'quantity')::numeric); END LOOP;
  IF v_output_done + v_this_qty > round(v_input_done * (1 - COALESCE(v_loss,0)), 2) + 0.001 THEN RAISE EXCEPTION 'MA_LOSS_VIOLATION' USING ERRCODE='P0001'; END IF;
  SELECT issued_cost - allocated_cost INTO v_avail FROM ma_manufacturing_orders WHERE id=p_mo_id;
  v_avail := COALESCE(v_avail,0);
  IF v_this_qty > 0 THEN v_unit := round(v_avail / v_this_qty, 4); END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (item->>'quantity')::numeric;
    v_color := COALESCE(item->>'color_code', '');
    SELECT * INTO rowr FROM ma_manufacturing_items
     WHERE mo_id=p_mo_id AND kind='output' AND product_id=(item->>'product_id') AND color_code=v_color;
    IF NOT FOUND THEN RAISE EXCEPTION 'MA_BAD_PARAM' USING ERRCODE='P0400'; END IF;
    IF rowr.done_quantity + v_qty > rowr.quantity THEN RAISE EXCEPTION 'MA_OVER_OUTPUT' USING ERRCODE='P0001'; END IF;
    PERFORM inv_apply_receipt_in(rowr.product_id, p_warehouse_id, v_qty, v_unit, 'manufacture_finish', v_no, '加工完工入库', p_user_id, v_color);
    v_alloc := v_alloc + v_qty * v_unit;
    UPDATE ma_manufacturing_items SET done_quantity=done_quantity+v_qty, unit_cost=v_unit WHERE id=rowr.id;
  END LOOP;
  UPDATE ma_manufacturing_orders SET allocated_cost=allocated_cost+v_alloc WHERE id=p_mo_id;
  IF (SELECT bool_and(done_quantity >= quantity) FROM ma_manufacturing_items WHERE mo_id=p_mo_id) THEN
    UPDATE ma_manufacturing_orders SET status='completed' WHERE id=p_mo_id;
  END IF;
  RETURN v_alloc;
END $$;
