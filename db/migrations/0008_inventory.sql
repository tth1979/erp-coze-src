-- 0008_inventory.sql —— 库存管理 V2：多仓库 + 批次 + 台账改名 + 调拨 + 盘点 + 预警
-- 开发库由 `coze-coding-ai db upgrade` 推送表结构（schema.ts 为唯一权威来源），
-- 本文件中的存量改造/RLS/规则种子/函数需在目标库执行（独立部署时使用）。
--
-- 范围：
--   1. inv_warehouses 仓库档案 + 默认仓 WH01
--   2. inv_stock 多仓化：warehouse_id 回填默认仓、唯一约束 (warehouse_id, product_id)、
--      新增 in_transit(在途)/frozen_quantity(冻结)；可用量 = quantity − frozen
--   3. inv_stock_movements 改名 inv_stock_ledger（只追加台账）+ warehouse_id/batch_id + CHECK 余额非负
--   4. inv_batches 批次表（入库自动生成批次：批号=来源单号；出库 FIFO 扣减；剩余量 CHECK 非负）
--   5. 购销单据加 warehouse_id（po/po_receipts/po_returns/so/so_shipments/so_returns），存量回填默认仓
--   6. md_products.safety_stock 安全库存阈值（预警口径：跨仓合计现有量 ≤ 阈值）
--   7. 调拨 inv_transfers(IT)/盘点 inv_checks(IC)：审批引擎一级 manager；plpgsql 单事务
--   8. 库存函数多仓重建：inv_apply_receipt_in(+仓+批次+source)/inv_apply_issue_out(+仓+FIFO+返回出库成本)
--      /inv_adjust_frozen/inv_execute_transfer/inv_receive_transfer/inv_execute_check；
--      购销终审函数同步带仓：po_execute_receipt/po_execute_return/po_reverse_receipt/po_fulfill_order
--      /so_execute_shipment(重构复用 issue_out)/so_execute_return(重构复用 receipt_in)/so_fulfill_order

-- ─────────────────────────────────────────
-- 1. 仓库档案 + 默认仓
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inv_warehouses (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  address TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO inv_warehouses (code, name, address) VALUES ('WH01', '主仓库', '默认仓库（系统初始化）')
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────
-- 2. inv_stock 多仓化（有数据表：先加列回填再设约束）
-- ─────────────────────────────────────────
ALTER TABLE inv_stock ADD COLUMN IF NOT EXISTS warehouse_id VARCHAR(36);
UPDATE inv_stock SET warehouse_id = (SELECT id FROM inv_warehouses WHERE code = 'WH01') WHERE warehouse_id IS NULL;
ALTER TABLE inv_stock ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE inv_stock ADD CONSTRAINT inv_stock_warehouse_id_inv_warehouses_id_fk
  FOREIGN KEY (warehouse_id) REFERENCES inv_warehouses(id);
ALTER TABLE inv_stock DROP CONSTRAINT IF EXISTS inv_stock_product_id_unique;
ALTER TABLE inv_stock ADD CONSTRAINT inv_stock_warehouse_product_unique UNIQUE (warehouse_id, product_id);
ALTER TABLE inv_stock ADD COLUMN IF NOT EXISTS in_transit NUMERIC(14,3) NOT NULL DEFAULT 0;
ALTER TABLE inv_stock ADD COLUMN IF NOT EXISTS frozen_quantity NUMERIC(14,3) NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────
-- 3. 台账改名 + 仓库/批次列 + CHECK 余额非负
-- ─────────────────────────────────────────
ALTER TABLE IF EXISTS inv_stock_movements RENAME TO inv_stock_ledger;
ALTER TABLE inv_stock_ledger ADD COLUMN IF NOT EXISTS warehouse_id VARCHAR(36);
ALTER TABLE inv_stock_ledger ADD COLUMN IF NOT EXISTS batch_id VARCHAR(36);
UPDATE inv_stock_ledger SET warehouse_id = (SELECT id FROM inv_warehouses WHERE code = 'WH01') WHERE warehouse_id IS NULL;
ALTER TABLE inv_stock_ledger ALTER COLUMN warehouse_id SET NOT NULL;
ALTER TABLE inv_stock_ledger ADD CONSTRAINT inv_stock_ledger_warehouse_fk
  FOREIGN KEY (warehouse_id) REFERENCES inv_warehouses(id);
ALTER TABLE inv_stock_ledger ADD CONSTRAINT inv_stock_ledger_balance_check CHECK (balance >= 0);

-- ─────────────────────────────────────────
-- 4. 批次表 + 调拨单 + 盘点单（新表 DDL，与 schema.ts 一致）
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inv_batches (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_no VARCHAR(40) NOT NULL,                 -- 批号（入库单号/退货单号/调拨单号）
  product_id VARCHAR(36) NOT NULL REFERENCES md_products(id),
  warehouse_id VARCHAR(36) NOT NULL REFERENCES inv_warehouses(id),
  unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0,    -- 批次入库成本快照（FIFO 对账）
  initial_quantity NUMERIC(14,3) NOT NULL,
  remaining_quantity NUMERIC(14,3) NOT NULL,     -- FIFO 扣减；CHECK 非负
  production_date DATE,
  expiry_date DATE,
  source_ref VARCHAR(40),                        -- 来源单号
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT inv_batches_unique UNIQUE (product_id, warehouse_id, batch_no),
  CONSTRAINT inv_batches_remaining_check CHECK (remaining_quantity >= 0)
);
CREATE INDEX IF NOT EXISTS inv_batches_product_idx ON inv_batches (product_id);
CREATE INDEX IF NOT EXISTS inv_batches_warehouse_idx ON inv_batches (warehouse_id);
CREATE INDEX IF NOT EXISTS inv_batches_expiry_idx ON inv_batches (expiry_date);

CREATE TABLE IF NOT EXISTS inv_transfers (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_no VARCHAR(32) NOT NULL UNIQUE,       -- ITyyyymmdd-NNNN
  from_warehouse_id VARCHAR(36) NOT NULL REFERENCES inv_warehouses(id),
  to_warehouse_id VARCHAR(36) NOT NULL REFERENCES inv_warehouses(id),
  -- draft → pending → approved(调出已出库/调入在途) → received；rejected 可重提；draft/pending/rejected → closed
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  transfer_date DATE NOT NULL,
  approval_level INTEGER,
  current_step INTEGER NOT NULL DEFAULT 0,
  submitted_by VARCHAR(36) REFERENCES sys_users(id),
  submitted_at TIMESTAMPTZ,
  approved_by VARCHAR(36) REFERENCES sys_users(id),
  approved_at TIMESTAMPTZ,
  reject_reason TEXT,
  received_at TIMESTAMPTZ,
  remark TEXT,
  created_by VARCHAR(36) REFERENCES sys_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inv_transfers_status_idx ON inv_transfers (status);
CREATE INDEX IF NOT EXISTS inv_transfers_created_at_idx ON inv_transfers (created_at);

CREATE TABLE IF NOT EXISTS inv_transfer_items (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id VARCHAR(36) NOT NULL REFERENCES inv_transfers(id) ON DELETE CASCADE,
  product_id VARCHAR(36) NOT NULL REFERENCES md_products(id),
  quantity NUMERIC(12,3) NOT NULL,
  unit_cost NUMERIC(14,4),                       -- 调出时加权均价快照（调入仓按此入账）
  unit VARCHAR(16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inv_transfer_items_doc_idx ON inv_transfer_items (transfer_id);
CREATE INDEX IF NOT EXISTS inv_transfer_items_product_idx ON inv_transfer_items (product_id);

CREATE TABLE IF NOT EXISTS inv_checks (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  check_no VARCHAR(32) NOT NULL UNIQUE,          -- ICyyyymmdd-NNNN
  warehouse_id VARCHAR(36) NOT NULL REFERENCES inv_warehouses(id),
  -- draft → pending → approved(差异已过账) / rejected；draft/pending/rejected → closed
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  check_date DATE NOT NULL,
  approval_level INTEGER,
  current_step INTEGER NOT NULL DEFAULT 0,
  submitted_by VARCHAR(36) REFERENCES sys_users(id),
  submitted_at TIMESTAMPTZ,
  approved_by VARCHAR(36) REFERENCES sys_users(id),
  approved_at TIMESTAMPTZ,
  reject_reason TEXT,
  remark TEXT,
  created_by VARCHAR(36) REFERENCES sys_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inv_checks_status_idx ON inv_checks (status);
CREATE INDEX IF NOT EXISTS inv_checks_warehouse_idx ON inv_checks (warehouse_id);

CREATE TABLE IF NOT EXISTS inv_check_items (
  id VARCHAR(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id VARCHAR(36) NOT NULL REFERENCES inv_checks(id) ON DELETE CASCADE,
  product_id VARCHAR(36) NOT NULL REFERENCES md_products(id),
  book_quantity NUMERIC(14,3) NOT NULL,          -- 建单账面快照
  counted_quantity NUMERIC(14,3) NOT NULL,       -- 实盘数量
  difference NUMERIC(14,3) NOT NULL DEFAULT 0,   -- 过账时按当时账面重算：实盘−账面
  unit_cost NUMERIC(14,4),                       -- 过账时加权均价快照
  unit VARCHAR(16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inv_check_items_doc_idx ON inv_check_items (check_id);
CREATE INDEX IF NOT EXISTS inv_check_items_product_idx ON inv_check_items (product_id);

-- ─────────────────────────────────────────
-- 5. 购销单据仓库列 + 存量回填默认仓
-- ─────────────────────────────────────────
ALTER TABLE po_receipts ADD COLUMN IF NOT EXISTS warehouse_id VARCHAR(36) REFERENCES inv_warehouses(id);
ALTER TABLE po_returns ADD COLUMN IF NOT EXISTS warehouse_id VARCHAR(36) REFERENCES inv_warehouses(id);
ALTER TABLE so_shipments ADD COLUMN IF NOT EXISTS warehouse_id VARCHAR(36) REFERENCES inv_warehouses(id);
ALTER TABLE so_returns ADD COLUMN IF NOT EXISTS warehouse_id VARCHAR(36) REFERENCES inv_warehouses(id);
ALTER TABLE po_purchase_orders ADD COLUMN IF NOT EXISTS warehouse_id VARCHAR(36) REFERENCES inv_warehouses(id);
ALTER TABLE so_sales_orders ADD COLUMN IF NOT EXISTS warehouse_id VARCHAR(36) REFERENCES inv_warehouses(id);
ALTER TABLE md_products ADD COLUMN IF NOT EXISTS safety_stock NUMERIC(12,3) NOT NULL DEFAULT 0;
UPDATE po_receipts SET warehouse_id = (SELECT id FROM inv_warehouses WHERE code='WH01') WHERE warehouse_id IS NULL;
UPDATE so_shipments SET warehouse_id = (SELECT id FROM inv_warehouses WHERE code='WH01') WHERE warehouse_id IS NULL;
UPDATE po_returns SET warehouse_id = (SELECT id FROM inv_warehouses WHERE code='WH01') WHERE warehouse_id IS NULL;
UPDATE so_returns SET warehouse_id = (SELECT id FROM inv_warehouses WHERE code='WH01') WHERE warehouse_id IS NULL;

-- ─────────────────────────────────────────
-- 6. RLS（不自建 Auth，不建 policy）
-- ─────────────────────────────────────────
ALTER TABLE inv_warehouses ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE inv_check_items ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────
-- 7. 审批规则种子：transfer/check 一级 [manager]
-- ─────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  INSERT INTO po_approval_rules (doc_type, level, min_amount, max_amount) VALUES
    ('transfer', 1, 0, NULL),
    ('check',    1, 0, NULL)
  ON CONFLICT DO NOTHING;
  FOR r IN SELECT id, doc_type FROM po_approval_rules WHERE doc_type IN ('transfer','check') LOOP
    IF NOT EXISTS (SELECT 1 FROM po_approval_rule_steps WHERE rule_id = r.id AND step_no = 1) THEN
      INSERT INTO po_approval_rule_steps (rule_id, step_no, approver_role) VALUES (r.id, 1, 'manager');
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────
-- 8. 库存核心函数多仓重建（签名变化：+p_warehouse_id / +p_source）
-- ─────────────────────────────────────────
DROP FUNCTION IF EXISTS inv_apply_movement(VARCHAR, NUMERIC, VARCHAR, VARCHAR, VARCHAR, TEXT, VARCHAR);
DROP FUNCTION IF EXISTS inv_apply_receipt_in(VARCHAR, NUMERIC, NUMERIC, VARCHAR, TEXT, VARCHAR);
DROP FUNCTION IF EXISTS inv_apply_issue_out(VARCHAR, NUMERIC, VARCHAR, VARCHAR, TEXT, VARCHAR);

-- 入库：仓维度移动加权 + 批次 upsert（批号=来源单号）+ 台账
CREATE OR REPLACE FUNCTION public.inv_apply_receipt_in(
  p_product_id character varying,
  p_warehouse_id character varying,
  p_quantity numeric,
  p_unit_cost numeric,
  p_source character varying,
  p_ref_no character varying,
  p_remark text,
  p_user_id character varying)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_qty   NUMERIC(14,3);
  v_total NUMERIC(16,2);
  v_avg   NUMERIC(14,4);
  v_new_qty   NUMERIC(14,3);
  v_new_total NUMERIC(16,2);
  v_new_avg   NUMERIC(14,4);
  v_batch_id  VARCHAR(36);
BEGIN
  SELECT quantity, total_cost, avg_cost INTO v_qty, v_total, v_avg
  FROM inv_stock WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id FOR UPDATE;
  v_qty := COALESCE(v_qty, 0); v_total := COALESCE(v_total, 0); v_avg := COALESCE(v_avg, 0);

  v_new_qty   := v_qty + p_quantity;
  v_new_total := v_total + ROUND(p_quantity * p_unit_cost, 2);
  IF v_new_qty > 0 THEN v_new_avg := ROUND(v_new_total / v_new_qty, 4); ELSE v_new_avg := v_avg; END IF;

  INSERT INTO inv_stock (id, warehouse_id, product_id, quantity, avg_cost, total_cost, updated_at)
  VALUES (gen_random_uuid(), p_warehouse_id, p_product_id, v_new_qty, v_new_avg, v_new_total, now())
  ON CONFLICT (warehouse_id, product_id)
  DO UPDATE SET quantity = EXCLUDED.quantity, avg_cost = EXCLUDED.avg_cost,
                total_cost = EXCLUDED.total_cost, updated_at = now();

  INSERT INTO inv_batches (id, batch_no, product_id, warehouse_id, unit_cost, initial_quantity, remaining_quantity, source_ref)
  VALUES (gen_random_uuid(), p_ref_no, p_product_id, p_warehouse_id, p_unit_cost, p_quantity, p_quantity, p_ref_no)
  ON CONFLICT (product_id, warehouse_id, batch_no)
  DO UPDATE SET initial_quantity   = inv_batches.initial_quantity + EXCLUDED.initial_quantity,
                remaining_quantity = inv_batches.remaining_quantity + EXCLUDED.remaining_quantity;
  SELECT id INTO v_batch_id FROM inv_batches
  WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id AND batch_no = p_ref_no;

  INSERT INTO inv_stock_ledger
    (id, warehouse_id, product_id, batch_id, type, quantity, balance, source, ref_no, remark, unit_cost, created_by)
  VALUES
    (gen_random_uuid(), p_warehouse_id, p_product_id, v_batch_id, 'in', p_quantity, v_new_qty,
     p_source, p_ref_no, p_remark, p_unit_cost, p_user_id);
  RETURN v_new_qty;
END;
$function$;

-- 出库：仓维度行锁 + 负库存拦截(P0001) + FIFO 扣批次 + 台账；返回本次出库成本总额
CREATE OR REPLACE FUNCTION public.inv_apply_issue_out(
  p_product_id character varying,
  p_warehouse_id character varying,
  p_quantity numeric,
  p_source character varying,
  p_ref_no character varying,
  p_remark text,
  p_user_id character varying)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_qty   NUMERIC(14,3);
  v_total NUMERIC(16,2);
  v_avg   NUMERIC(14,4);
  v_new_qty   NUMERIC(14,3);
  v_out_cost  NUMERIC(16,2);
  v_new_total NUMERIC(16,2);
  v_remain    NUMERIC(14,3);
  v_take      NUMERIC(14,3);
  v_batch_id  VARCHAR(36);
  b RECORD;
BEGIN
  SELECT quantity, total_cost, avg_cost INTO v_qty, v_total, v_avg
  FROM inv_stock WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id FOR UPDATE;
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
  WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id;

  v_remain := p_quantity;
  FOR b IN SELECT id, remaining_quantity FROM inv_batches
           WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id AND remaining_quantity > 0
           ORDER BY created_at ASC, id ASC FOR UPDATE LOOP
    EXIT WHEN v_remain <= 0;
    v_take := LEAST(b.remaining_quantity, v_remain);
    UPDATE inv_batches SET remaining_quantity = remaining_quantity - v_take WHERE id = b.id;
    IF v_batch_id IS NULL THEN v_batch_id := b.id; END IF;
    v_remain := v_remain - v_take;
  END LOOP;

  INSERT INTO inv_stock_ledger
    (id, warehouse_id, product_id, batch_id, type, quantity, balance, source, ref_no, remark, unit_cost, created_by)
  VALUES
    (gen_random_uuid(), p_warehouse_id, p_product_id, v_batch_id, 'out', -p_quantity, v_new_qty,
     p_source, p_ref_no, p_remark, v_avg, p_user_id);
  RETURN v_out_cost;
END;
$function$;

-- 冻结量调整：校验 0 ≤ frozen ≤ quantity（可用量 = quantity − frozen 恒非负）
CREATE OR REPLACE FUNCTION public.inv_adjust_frozen(
  p_product_id character varying,
  p_warehouse_id character varying,
  p_delta numeric,
  p_user_id character varying)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_qty NUMERIC(14,3);
  v_frozen NUMERIC(14,3);
  v_new NUMERIC(14,3);
BEGIN
  SELECT quantity, frozen_quantity INTO v_qty, v_frozen
  FROM inv_stock WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:该仓库无此商品库存行' USING ERRCODE = 'no_data_found';
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
  WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id;
  RETURN v_new;
END;
$function$;

-- ─────────────────────────────────────────
-- 9. 购销终审函数带仓重建
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.po_execute_receipt(p_receipt_id character varying, p_user_id character varying)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status VARCHAR; v_receipt_no VARCHAR; v_estimated BOOLEAN; v_warehouse VARCHAR(36);
  r RECORD;
BEGIN
  SELECT status, receipt_no, is_estimated,
         COALESCE(warehouse_id, (SELECT id FROM inv_warehouses WHERE code = 'WH01'))
  INTO v_status, v_receipt_no, v_estimated, v_warehouse
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
      r.product_id, v_warehouse, r.quantity, r.unit_price, 'purchase_in', v_receipt_no,
      CASE WHEN v_estimated THEN '暂估入库' ELSE '采购入库' END, p_user_id
    );
  END LOOP;

  UPDATE po_receipts
  SET status = 'approved', approved_by = p_user_id, approved_at = now(), updated_at = now()
  WHERE id = p_receipt_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.po_execute_return(p_return_id character varying, p_user_id character varying)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status VARCHAR; v_return_no VARCHAR; v_warehouse VARCHAR(36);
  r RECORD;
BEGIN
  SELECT status, return_no,
         COALESCE(warehouse_id, (SELECT id FROM inv_warehouses WHERE code = 'WH01'))
  INTO v_status, v_return_no, v_warehouse
  FROM po_returns WHERE id = p_return_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:退货单不存在' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'P0400:仅待审退货单可审核通过，当前状态：%', v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR r IN SELECT product_id, quantity FROM po_return_items WHERE return_id = p_return_id LOOP
    PERFORM inv_apply_issue_out(r.product_id, v_warehouse, r.quantity, 'purchase_return', v_return_no, '采购退货出库', p_user_id);
  END LOOP;

  UPDATE po_returns
  SET status = 'approved', approved_by = p_user_id, approved_at = now(), updated_at = now()
  WHERE id = p_return_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.po_reverse_receipt(p_receipt_id character varying, p_invoice_no character varying, p_items jsonb, p_user_id character varying)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v RECORD;
  v_red_id VARCHAR := gen_random_uuid();
  v_blue_id VARCHAR := gen_random_uuid();
  v_red_no VARCHAR; v_blue_no VARCHAR;
  v_day VARCHAR := to_char(now(), 'YYYYMMDD');
  v_blue_total NUMERIC(14,2) := 0;
  v_warehouse VARCHAR(36);
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
  v_warehouse := COALESCE(v.warehouse_id, (SELECT id FROM inv_warehouses WHERE code = 'WH01'));

  v_red_no  := 'GRR' || v_day || '-' || lpad((
    SELECT (COALESCE(MAX(CAST(substring(receipt_no from '-(\d+)$') AS INTEGER)), 0) + 1)::text
    FROM po_receipts WHERE receipt_no LIKE 'GRR' || v_day || '-%'), 4, '0');
  v_blue_no := 'GRB' || v_day || '-' || lpad((
    SELECT (COALESCE(MAX(CAST(substring(receipt_no from '-(\d+)$') AS INTEGER)), 0) + 1)::text
    FROM po_receipts WHERE receipt_no LIKE 'GRB' || v_day || '-%'), 4, '0');

  INSERT INTO po_receipts
    (id, receipt_no, order_id, supplier_id, warehouse_id, status, is_estimated, invoice_no,
     reversal_of_id, reversal_kind, total_amount, receive_date, remark, created_by, approved_by, approved_at)
  VALUES
    (v_red_id, v_red_no, v.order_id, v.supplier_id, v_warehouse, 'approved', true, p_invoice_no,
     v.id, 'red', v.total_amount, CURRENT_DATE,
     '红字冲回 ' || v.receipt_no, p_user_id, p_user_id, now());
  INSERT INTO po_receipt_items (receipt_id, product_id, quantity, unit_price, amount, unit)
  SELECT v_red_id, product_id, quantity, unit_price, amount, unit
  FROM po_receipt_items WHERE receipt_id = v.id;

  FOR item IN SELECT product_id, quantity FROM po_receipt_items WHERE receipt_id = v.id LOOP
    PERFORM inv_apply_issue_out(item.product_id, v_warehouse, item.quantity, 'receipt_reversal', v_red_no, '暂估红字冲回', p_user_id);
  END LOOP;

  INSERT INTO po_receipts
    (id, receipt_no, order_id, supplier_id, warehouse_id, status, is_estimated, invoice_no,
     reversal_of_id, reversal_kind, total_amount, receive_date, remark, created_by, approved_by, approved_at)
  VALUES
    (v_blue_id, v_blue_no, v.order_id, v.supplier_id, v_warehouse, 'approved', false, p_invoice_no,
     v.id, 'blue', 0, CURRENT_DATE,
     '蓝字重入 ' || v.receipt_no || '（发票 ' || COALESCE(p_invoice_no, '—') || '）', p_user_id, p_user_id, now());

  FOR item IN SELECT * FROM jsonb_to_recordset(p_items) AS x(product_id VARCHAR, quantity NUMERIC, unit_price NUMERIC) LOOP
    INSERT INTO po_receipt_items (receipt_id, product_id, quantity, unit_price, amount, unit)
    SELECT v_blue_id, item.product_id, item.quantity, item.unit_price,
           ROUND(item.quantity * item.unit_price, 2), p.unit
    FROM md_products p WHERE p.id = item.product_id;
    v_blue_total := v_blue_total + ROUND(item.quantity * item.unit_price, 2);
    PERFORM inv_apply_receipt_in(item.product_id, v_warehouse, item.quantity, item.unit_price, 'receipt_blue_in', v_blue_no, '来票蓝字入库', p_user_id);
  END LOOP;
  UPDATE po_receipts SET total_amount = v_blue_total WHERE id = v_blue_id;

  UPDATE po_receipts
  SET status = 'reversed', invoice_no = p_invoice_no, updated_at = now()
  WHERE id = v.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.po_fulfill_order(p_order_id character varying, p_user_id character varying)
 RETURNS character varying
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status VARCHAR; v_order_no VARCHAR; v_supplier VARCHAR; v_total NUMERIC(14,2);
  v_receipt_id VARCHAR := gen_random_uuid();
  v_receipt_no VARCHAR;
  v_existing INT;
  v_warehouse VARCHAR(36);
  r RECORD;
BEGIN
  SELECT status, order_no, supplier_id, total_amount,
         COALESCE(warehouse_id, (SELECT id FROM inv_warehouses WHERE code = 'WH01'))
  INTO v_status, v_order_no, v_supplier, v_total, v_warehouse
  FROM po_purchase_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:采购订单不存在' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'P0400:仅已审订单可到货入库，当前状态：%', v_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

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
    (id, receipt_no, order_id, supplier_id, warehouse_id, status, is_estimated, total_amount, receive_date,
     remark, created_by, approved_by, approved_at)
  VALUES
    (v_receipt_id, v_receipt_no, p_order_id, v_supplier, v_warehouse, 'approved', false, v_total,
     CURRENT_DATE, '订单到货一键入库', p_user_id, p_user_id, now());
  INSERT INTO po_receipt_items (receipt_id, product_id, quantity, unit_price, amount, unit)
  SELECT v_receipt_id, product_id, quantity, unit_price, amount, unit
  FROM po_purchase_order_items WHERE order_id = p_order_id;

  FOR r IN SELECT product_id, quantity, unit_price FROM po_purchase_order_items WHERE order_id = p_order_id LOOP
    PERFORM inv_apply_receipt_in(r.product_id, v_warehouse, r.quantity, r.unit_price, 'purchase_in', v_receipt_no, '采购到货入库', p_user_id);
  END LOOP;

  UPDATE po_purchase_orders SET status = 'received', updated_at = now() WHERE id = p_order_id;
  RETURN v_receipt_no;
END;
$function$;

CREATE OR REPLACE FUNCTION public.so_execute_shipment(p_shipment_id character varying, p_user_id character varying)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v RECORD;
  r RECORD;
  v_warehouse VARCHAR(36);
  v_line_cost NUMERIC(16,2); v_total_cost NUMERIC(16,2) := 0;
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
  v_warehouse := COALESCE(v.warehouse_id, (SELECT id FROM inv_warehouses WHERE code = 'WH01'));

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

  FOR r IN SELECT id, product_id, quantity FROM so_shipment_items WHERE shipment_id = p_shipment_id LOOP
    v_line_cost := inv_apply_issue_out(r.product_id, v_warehouse, r.quantity, 'sales_out', v.shipment_no, '销售出库', p_user_id);
    v_total_cost := v_total_cost + v_line_cost;
    UPDATE so_shipment_items SET cost = v_line_cost WHERE id = r.id;
  END LOOP;

  UPDATE so_shipments
  SET status = 'approved', total_cost = v_total_cost, warehouse_id = v_warehouse,
      approved_by = p_user_id, approved_at = now(), updated_at = now()
  WHERE id = p_shipment_id;

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
$function$;

CREATE OR REPLACE FUNCTION public.so_execute_return(p_return_id character varying, p_user_id character varying)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v RECORD;
  r RECORD;
  v_warehouse VARCHAR(36);
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
  v_warehouse := COALESCE(v.warehouse_id, (SELECT id FROM inv_warehouses WHERE code = 'WH01'));

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

  FOR r IN SELECT product_id, quantity, unit_cost FROM so_return_items WHERE return_id = p_return_id LOOP
    v_cost := COALESCE(r.unit_cost, 0);
    PERFORM inv_apply_receipt_in(r.product_id, v_warehouse, r.quantity, v_cost, 'sales_return_in', v.return_no, '销售退货入库', p_user_id);
  END LOOP;

  UPDATE so_returns
  SET status = 'approved', approved_by = p_user_id, approved_at = now(), updated_at = now()
  WHERE id = p_return_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.so_fulfill_order(p_order_id character varying, p_user_id character varying)
 RETURNS character varying
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status VARCHAR; v_order_no VARCHAR; v_customer VARCHAR; v_total NUMERIC(14,2);
  v_shipment_id VARCHAR := gen_random_uuid();
  v_shipment_no VARCHAR;
  v_existing INT;
  v_warehouse VARCHAR(36);
BEGIN
  SELECT status, order_no, customer_id, total_amount,
         COALESCE(warehouse_id, (SELECT id FROM inv_warehouses WHERE code = 'WH01'))
  INTO v_status, v_order_no, v_customer, v_total, v_warehouse
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
    (id, shipment_no, order_id, customer_id, warehouse_id, status, ship_date, total_amount,
     remark, created_by)
  VALUES
    (v_shipment_id, v_shipment_no, p_order_id, v_customer, v_warehouse, 'pending', CURRENT_DATE, v_total,
     '订单发货一键出库', p_user_id);
  INSERT INTO so_shipment_items (shipment_id, product_id, quantity, unit_price, amount, unit)
  SELECT v_shipment_id, product_id, quantity, unit_price, amount, unit
  FROM so_sales_order_items WHERE order_id = p_order_id;

  PERFORM so_execute_shipment(v_shipment_id, p_user_id);
  RETURN v_shipment_no;
END;
$function$;

-- ─────────────────────────────────────────
-- 10. 调拨 / 盘点终审函数
-- ─────────────────────────────────────────
-- 调拨审核：调出仓出库（负库存拦截+FIFO扣批次）+ 调入仓在途增加，单事务
CREATE OR REPLACE FUNCTION public.inv_execute_transfer(p_transfer_id character varying, p_user_id character varying)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v RECORD;
  r RECORD;
  v_cost NUMERIC(16,2);
BEGIN
  SELECT * INTO v FROM inv_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:调拨单不存在' USING ERRCODE = 'no_data_found';
  END IF;
  IF v.status <> 'pending' THEN
    RAISE EXCEPTION 'P0400:仅待审调拨单可审核通过，当前状态：%', v.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF v.from_warehouse_id = v.to_warehouse_id THEN
    RAISE EXCEPTION 'P0400:调出与调入仓库不能相同' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR r IN SELECT id, product_id, quantity FROM inv_transfer_items WHERE transfer_id = p_transfer_id LOOP
    v_cost := inv_apply_issue_out(r.product_id, v.from_warehouse_id, r.quantity, 'transfer_out', v.transfer_no, '调拨出库', p_user_id);
    UPDATE inv_transfer_items SET unit_cost = ROUND(v_cost / r.quantity, 4) WHERE id = r.id;
    INSERT INTO inv_stock (id, warehouse_id, product_id, quantity, in_transit, updated_at)
    VALUES (gen_random_uuid(), v.to_warehouse_id, r.product_id, 0, r.quantity, now())
    ON CONFLICT (warehouse_id, product_id)
    DO UPDATE SET in_transit = inv_stock.in_transit + r.quantity, updated_at = now();
  END LOOP;

  UPDATE inv_transfers
  SET status = 'approved', approved_by = p_user_id, approved_at = now(), updated_at = now()
  WHERE id = p_transfer_id;
END;
$function$;

-- 调拨收货：调入仓在途转库存（按调出成本入账，生成调拨批次），单事务
CREATE OR REPLACE FUNCTION public.inv_receive_transfer(p_transfer_id character varying, p_user_id character varying)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v RECORD;
  r RECORD;
  v_transit NUMERIC(14,3);
BEGIN
  SELECT * INTO v FROM inv_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:调拨单不存在' USING ERRCODE = 'no_data_found';
  END IF;
  IF v.status <> 'approved' THEN
    RAISE EXCEPTION 'P0400:仅已审（在途）调拨单可收货，当前状态：%', v.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR r IN SELECT product_id, quantity, unit_cost FROM inv_transfer_items WHERE transfer_id = p_transfer_id LOOP
    SELECT in_transit INTO v_transit FROM inv_stock
    WHERE warehouse_id = v.to_warehouse_id AND product_id = r.product_id FOR UPDATE;
    v_transit := COALESCE(v_transit, 0);
    IF v_transit - r.quantity < 0 THEN
      RAISE EXCEPTION 'P0400:调入仓在途量不足（在途 %，本次收货 %）', v_transit, r.quantity
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
    UPDATE inv_stock SET in_transit = in_transit - r.quantity, updated_at = now()
    WHERE warehouse_id = v.to_warehouse_id AND product_id = r.product_id;
    PERFORM inv_apply_receipt_in(r.product_id, v.to_warehouse_id, r.quantity,
      COALESCE(r.unit_cost, 0), 'transfer_in', v.transfer_no, '调拨入库', p_user_id);
  END LOOP;

  UPDATE inv_transfers
  SET status = 'received', received_at = now(), updated_at = now()
  WHERE id = p_transfer_id;
END;
$function$;

-- 盘点审核：过账时按当时账面重算差异，盘盈入库/盘亏出库（负库存拦截），单事务
CREATE OR REPLACE FUNCTION public.inv_execute_check(p_check_id character varying, p_user_id character varying)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v RECORD;
  r RECORD;
  v_book NUMERIC(14,3);
  v_avg  NUMERIC(14,4);
  v_diff NUMERIC(14,3);
BEGIN
  SELECT * INTO v FROM inv_checks WHERE id = p_check_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'P0404:盘点单不存在' USING ERRCODE = 'no_data_found';
  END IF;
  IF v.status <> 'pending' THEN
    RAISE EXCEPTION 'P0400:仅待审盘点单可审核通过，当前状态：%', v.status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  FOR r IN SELECT id, product_id, counted_quantity FROM inv_check_items WHERE check_id = p_check_id LOOP
    SELECT quantity, avg_cost INTO v_book, v_avg FROM inv_stock
    WHERE warehouse_id = v.warehouse_id AND product_id = r.product_id FOR UPDATE;
    v_book := COALESCE(v_book, 0); v_avg := COALESCE(v_avg, 0);
    v_diff := r.counted_quantity - v_book;
    UPDATE inv_check_items SET difference = v_diff, unit_cost = v_avg WHERE id = r.id;
    IF v_diff > 0 THEN
      PERFORM inv_apply_receipt_in(r.product_id, v.warehouse_id, v_diff, v_avg, 'check_in', v.check_no, '盘盈入库', p_user_id);
    ELSIF v_diff < 0 THEN
      PERFORM inv_apply_issue_out(r.product_id, v.warehouse_id, -v_diff, 'check_out', v.check_no, '盘亏出库', p_user_id);
    END IF;
  END LOOP;

  UPDATE inv_checks
  SET status = 'approved', approved_by = p_user_id, approved_at = now(), updated_at = now()
  WHERE id = p_check_id;
END;
$function$;
