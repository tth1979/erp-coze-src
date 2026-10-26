-- =============================================================
-- 0012 加工管理（ma_*）
-- 加工单(MO)：经通用审批引擎(批准后)按 BOM 分批领料/完工，
--             plpgsql 单事务保证 投入-产出-损耗 数量守恒 + 成本分摊入成品。
-- 幂等 + RLS；新表前缀 ma_；单据单号 MAyyyymmdd-NNNN。
-- =============================================================

-- 1. 加工单主表
CREATE TABLE IF NOT EXISTS public.ma_manufacturing_orders (
  id               varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_no           varchar(40) NOT NULL UNIQUE,                 -- MAyyyymmdd-NNNN
  processing_type  varchar(48) NOT NULL,                        -- 字典 processing_type
  loss_ratio       numeric(5,4) NOT NULL DEFAULT 0.05,          -- 损耗比例（如 0.05=5%）
  status           varchar(20) NOT NULL DEFAULT 'draft',        -- draft/pending/approved/completed/closed
  estimate_cost    numeric(14,2) NOT NULL DEFAULT 0,            -- 预计成本（审批定级依据）
  issued_cost      numeric(14,2) NOT NULL DEFAULT 0,            -- 累计领料成本（移动加权均价）
  allocated_cost   numeric(14,2) NOT NULL DEFAULT 0,            -- 累计分摊入成品成本
  remark           text,
  approval_level   smallint NOT NULL DEFAULT 0,
  current_step     smallint NOT NULL DEFAULT 0,
  submitted_by     varchar(36), submitted_at timestamptz,
  approved_by      varchar(36), approved_at timestamptz,
  reject_reason    text,
  created_by       varchar(36), created_at timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ma_orders_status_idx ON public.ma_manufacturing_orders(status);
CREATE INDEX IF NOT EXISTS ma_orders_type_idx   ON public.ma_manufacturing_orders(processing_type);
CREATE INDEX IF NOT EXISTS ma_orders_created_idx ON public.ma_manufacturing_orders(created_at);

-- 2. 加工单明细（kind=input 投入原料 / output 产出成品）
CREATE TABLE IF NOT EXISTS public.ma_manufacturing_items (
  id            varchar(36) PRIMARY KEY DEFAULT gen_random_uuid(),
  mo_id         varchar(36) NOT NULL REFERENCES public.ma_manufacturing_orders(id) ON DELETE CASCADE,
  line_no       smallint NOT NULL DEFAULT 1,
  kind          varchar(10) NOT NULL,
  product_id    varchar(36) NOT NULL,
  product_name  varchar(128), sku_code varchar(64), unit_name varchar(32),
  quantity      numeric(14,2) NOT NULL,                         -- 计划数量
  unit_cost     numeric(14,2) NOT NULL DEFAULT 0,               -- 领料均价 / 完工分摊单价
  done_quantity numeric(14,2) NOT NULL DEFAULT 0,               -- 已完成（已领/已完）数量
  warehouse_id  varchar(36)
);
CREATE INDEX IF NOT EXISTS ma_items_mo_idx ON public.ma_manufacturing_items(mo_id);

ALTER TABLE public.ma_manufacturing_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ma_manufacturing_items ENABLE ROW LEVEL SECURITY;

-- 3. 加工类型字典（扩展系统字典）
INSERT INTO dict_system_types (type_code, name, description, is_system, sort)
  VALUES ('processing_type', '加工类型', '瓷砖加工类型', true, 6)
  ON CONFLICT (type_code) DO NOTHING;
INSERT INTO dict_system_items (type_code, item_code, label, extra, sort) VALUES
  ('processing_type', 'cut',    '切割',   '{}', 1),
  ('processing_type', 'groove', '开槽',   '{}', 2),
  ('processing_type', 'edge',   '磨边',   '{}', 3),
  ('processing_type', 'combo',  '组合拼贴','{}', 4),
  ('processing_type', 'other',  '其他',   '{}', 5)
  ON CONFLICT (type_code, item_code) DO NOTHING;

-- 4. 审批规则（复用通用引擎，doc_type='manufacture'，两档）
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM po_approval_rules WHERE doc_type='manufacture') THEN
    INSERT INTO po_approval_rules (doc_type, level, min_amount, max_amount) VALUES
      ('manufacture', 1, 0, 50000),
      ('manufacture', 2, 50000, NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM po_approval_rule_steps s JOIN po_approval_rules r ON r.id=s.rule_id WHERE r.doc_type='manufacture' AND s.step_no=1) THEN
    INSERT INTO po_approval_rule_steps (rule_id, step_no, approver_role)
      SELECT r.id, 1, 'manager' FROM po_approval_rules r WHERE r.doc_type='manufacture' AND r.level=1;
    INSERT INTO po_approval_rule_steps (rule_id, step_no, approver_role)
      SELECT r.id, 1, 'manager' FROM po_approval_rules r WHERE r.doc_type='manufacture' AND r.level=2;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM po_approval_rule_steps s JOIN po_approval_rules r ON r.id=s.rule_id WHERE r.doc_type='manufacture' AND s.step_no=2) THEN
    INSERT INTO po_approval_rule_steps (rule_id, step_no, approver_role)
      SELECT r.id, 2, 'admin' FROM po_approval_rules r WHERE r.doc_type='manufacture' AND r.level=2;
  END IF;
END $$;

-- 5. 加工领料：扣原料库存（移动加权均价），只允许 approved；按行累计不超计划
CREATE OR REPLACE FUNCTION public.mo_execute_issue(p_mo_id varchar, p_warehouse_id varchar, p_items jsonb, p_user_id varchar)
RETURNS numeric AS $$
DECLARE
  v_no varchar; v_status varchar; item jsonb; rowr record;
  v_qty numeric; v_cost numeric := 0; c numeric;
BEGIN
  SELECT doc_no, status INTO v_no, v_status FROM ma_manufacturing_orders WHERE id=p_mo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MA_NOT_FOUND' USING ERRCODE='P0404'; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'MA_BAD_STATE' USING ERRCODE='P0400'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (item->>'quantity')::numeric;
    SELECT * INTO rowr FROM ma_manufacturing_items
      WHERE mo_id=p_mo_id AND kind='input' AND product_id=(item->>'product_id');
    IF NOT FOUND THEN RAISE EXCEPTION 'MA_BAD_PARAM' USING ERRCODE='P0400'; END IF;
    IF rowr.done_quantity + v_qty > rowr.quantity THEN RAISE EXCEPTION 'MA_OVER_ISSUE' USING ERRCODE='P0001'; END IF;
    SELECT inv_apply_issue_out(rowr.product_id, p_warehouse_id, v_qty, 'manufacture_issue', v_no, '加工领料', p_user_id) INTO c;
    v_cost := v_cost + COALESCE(c, 0);
    UPDATE ma_manufacturing_items SET done_quantity = done_quantity + v_qty WHERE id = rowr.id;
  END LOOP;
  UPDATE ma_manufacturing_orders SET issued_cost = issued_cost + v_cost WHERE id = p_mo_id;
  RETURN v_cost;
END $$ LANGUAGE plpgsql;

-- 6. 加工完工：守恒校验(产出<=投入*(1-损耗)) + 按未分摊成本入库产成品
CREATE OR REPLACE FUNCTION public.mo_execute_finish(p_mo_id varchar, p_warehouse_id varchar, p_items jsonb, p_user_id varchar)
RETURNS numeric AS $$
DECLARE
  v_no varchar; v_status varchar; v_loss numeric; item jsonb; rowr record;
  v_qty numeric; v_input_done numeric := 0; v_output_done numeric := 0;
  v_this_qty numeric := 0; v_avail numeric := 0; v_unit numeric := 0; v_alloc numeric := 0;
BEGIN
  SELECT doc_no, status, loss_ratio INTO v_no, v_status, v_loss FROM ma_manufacturing_orders WHERE id=p_mo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'MA_NOT_FOUND' USING ERRCODE='P0404'; END IF;
  IF v_status <> 'approved' THEN RAISE EXCEPTION 'MA_BAD_STATE' USING ERRCODE='P0400'; END IF;
  SELECT COALESCE(sum(done_quantity),0) INTO v_input_done FROM ma_manufacturing_items WHERE mo_id=p_mo_id AND kind='input';
  SELECT COALESCE(sum(done_quantity),0) INTO v_output_done FROM ma_manufacturing_items WHERE mo_id=p_mo_id AND kind='output';
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_this_qty := v_this_qty + ((item->>'quantity')::numeric);
  END LOOP;
  -- 投入-产出-损耗守恒
  IF v_output_done + v_this_qty > round(v_input_done * (1 - COALESCE(v_loss,0)), 2) + 0.001 THEN
    RAISE EXCEPTION 'MA_LOSS_VIOLATION' USING ERRCODE='P0001';
  END IF;
  SELECT issued_cost - allocated_cost INTO v_avail FROM ma_manufacturing_orders WHERE id=p_mo_id;
  v_avail := COALESCE(v_avail, 0);
  IF v_this_qty > 0 THEN v_unit := round(v_avail / v_this_qty, 4); END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (item->>'quantity')::numeric;
    SELECT * INTO rowr FROM ma_manufacturing_items
      WHERE mo_id=p_mo_id AND kind='output' AND product_id=(item->>'product_id');
    IF NOT FOUND THEN RAISE EXCEPTION 'MA_BAD_PARAM' USING ERRCODE='P0400'; END IF;
    IF rowr.done_quantity + v_qty > rowr.quantity THEN RAISE EXCEPTION 'MA_OVER_OUTPUT' USING ERRCODE='P0001'; END IF;
    PERFORM inv_apply_receipt_in(rowr.product_id, p_warehouse_id, v_qty, v_unit, 'manufacture_finish', v_no, '加工完工入库', p_user_id);
    v_alloc := v_alloc + v_qty * v_unit;
    UPDATE ma_manufacturing_items SET done_quantity = done_quantity + v_qty, unit_cost = v_unit WHERE id = rowr.id;
  END LOOP;
  UPDATE ma_manufacturing_orders SET allocated_cost = allocated_cost + v_alloc WHERE id = p_mo_id;
  -- 投入与产出全部完成 → 完工
  IF (SELECT bool_and(done_quantity >= quantity) FROM ma_manufacturing_items WHERE mo_id=p_mo_id) THEN
    UPDATE ma_manufacturing_orders SET status = 'completed' WHERE id = p_mo_id;
  END IF;
  RETURN v_alloc;
END $$ LANGUAGE plpgsql;